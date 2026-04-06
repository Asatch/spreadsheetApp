#!/usr/bin/env python3
"""
Import a zip package into a function-workshop workfolder.

Unpacks functions from a zip (created by the frontend export or export_zip.py)
into a workfolder directory and reconstructs registry.json.

Usage:
    python import_zip.py --workfolder workfolders/my-suite path/to/package.zip
    python import_zip.py --list path/to/package.zip
"""

import argparse
import json
import os
import sys
import zipfile
import xml.etree.ElementTree as ET


def parse_custom_functions_from_xml(xml_content):
    """Extract CustomFunctions dependencies from XML content."""
    try:
        root = ET.fromstring(xml_content)
    except ET.ParseError:
        return []

    cf = root.find("CustomFunctions")
    if cf is None:
        return []

    deps = []
    for func_elem in cf.findall("Function"):
        name = func_elem.get("name")
        if name:
            deps.append(name.upper())
    return deps


def detect_sheet_type(xml_content):
    """Detect sheet type from XML root element."""
    try:
        root = ET.fromstring(xml_content)
        return root.get("sheetType", "standard")
    except ET.ParseError:
        return "standard"


def read_manifest_entries(zf):
    """Read function entries from a zip manifest, handling both v1 and v2 formats.

    Returns list of dicts with keys: uid, name, description, sheetType.
    """
    try:
        manifest = json.loads(zf.read("manifest.json"))
    except KeyError:
        print("Error: Zip has no manifest.json", file=sys.stderr)
        sys.exit(1)

    entries = []

    # v1 format: manifest.functions
    functions = manifest.get("functions", {})
    if functions:
        for uid, meta in functions.items():
            entries.append({
                "uid": uid,
                "name": meta.get("name", "").upper(),
                "description": meta.get("description", ""),
                "sheetType": meta.get("sheetType", "standard"),
            })
        return entries, manifest

    # v2 format: manifest.sheets
    sheets = manifest.get("sheets", {})
    for sheet_id, meta in sheets.items():
        entries.append({
            "uid": sheet_id,
            "name": meta.get("name", "").upper(),
            "description": meta.get("description", ""),
            "sheetType": meta.get("type", "standard"),
        })

    # Also check manifest.spreadsheets (v1 without functions)
    if not entries:
        spreadsheets = manifest.get("spreadsheets", {})
        for sheet_id, meta in spreadsheets.items():
            entries.append({
                "uid": sheet_id,
                "name": meta.get("name", "").upper(),
                "description": meta.get("description", ""),
                "sheetType": meta.get("type", "standard"),
            })

    return entries, manifest


def list_zip_contents(zip_path):
    """List functions in a zip without importing."""
    with zipfile.ZipFile(zip_path) as zf:
        entries, _ = read_manifest_entries(zf)

    if not entries:
        print("(empty package)")
        return

    # Calculate column widths
    name_width = max(len(e["name"]) for e in entries)
    type_width = max(len(e["sheetType"]) for e in entries)

    for entry in sorted(entries, key=lambda e: e["name"]):
        name = entry["name"].ljust(name_width)
        stype = entry["sheetType"].ljust(type_width)
        desc = entry["description"]
        if desc:
            print(f"  {name}  {stype}  {desc}")
        else:
            print(f"  {name}  {stype}")


def import_zip(workfolder_dir, zip_path):
    """Import a zip into a workfolder directory."""
    if not os.path.exists(zip_path):
        print(f"Error: Zip not found: {zip_path}", file=sys.stderr)
        sys.exit(1)

    # Create workfolder directory
    os.makedirs(workfolder_dir, exist_ok=True)

    # Load existing registry (if any)
    reg_path = os.path.join(workfolder_dir, "registry.json")
    if os.path.exists(reg_path):
        with open(reg_path) as f:
            registry = json.load(f)
    else:
        registry = {}

    with zipfile.ZipFile(zip_path) as zf:
        entries, manifest = read_manifest_entries(zf)
        imported = 0

        for entry in entries:
            uid = entry["uid"]
            func_name = entry["name"]

            # Try v1 path first, then v2
            xml_content = None
            for xml_zip_path in [f"functions/{uid}.xml", f"sheets/{uid}.xml", f"spreadsheets/{uid}.xml"]:
                try:
                    xml_content = zf.read(xml_zip_path).decode("utf-8")
                    break
                except KeyError:
                    continue

            if xml_content is None:
                print(f"Warning: No XML found for {func_name}, skipping", file=sys.stderr)
                continue

            # Extract JS (may not exist)
            js_content = None
            for js_zip_path in [f"functions/{uid}.js", f"sheets/{uid}.published.js"]:
                try:
                    js_content = zf.read(js_zip_path).decode("utf-8")
                    break
                except KeyError:
                    continue

            # Write to workfolder directory (sanitize name to prevent path traversal)
            safe_name = os.path.basename(func_name)
            xml_filename = f"{safe_name}.xml"
            js_filename = f"{safe_name}.js"

            with open(os.path.join(workfolder_dir, xml_filename), "w") as f:
                f.write(xml_content)

            if js_content:
                with open(os.path.join(workfolder_dir, js_filename), "w") as f:
                    f.write(js_content)

            # Detect dependencies from XML
            dep_names = parse_custom_functions_from_xml(xml_content)

            # Detect sheet type
            sheet_type = entry["sheetType"]
            if sheet_type == "spreadsheet":
                sheet_type = "standard"

            # Build registry entry
            reg_entry = {
                "uuid": uid,
                "xml": xml_filename,
                "js": js_filename,
                "sheetType": sheet_type,
                "dependencies": dep_names,
            }
            if entry["description"]:
                reg_entry["description"] = entry["description"]

            registry[func_name] = reg_entry

            status = "xml+js" if js_content else "xml only"
            print(f"  Imported {func_name} ({status})")
            imported += 1

    # Save registry
    with open(reg_path, "w") as f:
        json.dump(registry, f, indent=2)
        f.write("\n")

    print(f"\nImported {imported} function(s) into {workfolder_dir}")
    if any(not os.path.exists(os.path.join(workfolder_dir, r["js"])) for r in registry.values()):
        print("Note: Some functions have no JS — run `python transpile.py --workfolder {} --all` to transpile".format(workfolder_dir))


def main():
    parser = argparse.ArgumentParser(description="Import zip into workfolder directory")
    parser.add_argument("--workfolder", help="Path to workfolder directory")
    parser.add_argument("--list", action="store_true", help="List zip contents without importing")
    parser.add_argument("zipfile", help="Path to zip file to import")

    args = parser.parse_args()

    if args.list:
        list_zip_contents(args.zipfile)
    elif args.workfolder:
        import_zip(args.workfolder, args.zipfile)
    else:
        print("Error: Either --list or --workfolder is required", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
