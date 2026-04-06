#!/usr/bin/env python3
"""
Export a function-workshop workfolder to a zip compatible with frontend import.

Reads the workfolder registry, resolves transitive dependencies, and produces:
  - manifest.json
  - functions/{uuid}.xml + functions/{uuid}.js
  - spreadsheets/local-{uuid}.xml

Usage:
    python export_zip.py --workfolder workfolders/my-suite
    python export_zip.py --workfolder workfolders/my-suite --output my-package.zip
    python export_zip.py --workfolder workfolders/my-suite FUNC1 FUNC2  # specific functions
"""

import argparse
import json
import os
import sys
import uuid
import zipfile
from datetime import datetime, timezone


def load_registry(workfolder_dir):
    path = os.path.join(workfolder_dir, "registry.json")
    if not os.path.exists(path):
        print(f"Error: No registry.json in {workfolder_dir}", file=sys.stderr)
        sys.exit(1)
    with open(path) as f:
        return json.load(f)


def resolve_transitive_deps(func_names, registry):
    """Resolve all transitive dependencies for a set of functions."""
    all_names = set()
    to_process = list(func_names)

    while to_process:
        name = to_process.pop()
        if name in all_names:
            continue
        all_names.add(name)

        entry = registry.get(name)
        if not entry:
            print(f"Warning: {name} not in registry, skipping", file=sys.stderr)
            continue

        for dep in entry.get("dependencies", []):
            if dep not in all_names:
                to_process.append(dep)

    return all_names


def is_display_only(xml_path):
    """Check if a spreadsheet XML has no outputs (display-only, not a callable function)."""
    from lxml import etree as ET
    tree = ET.parse(xml_path)
    return len(tree.findall(".//Output")) == 0


def build_manifest(func_names, display_names, registry):
    """Build manifest.json content.

    func_names: spreadsheets that are callable functions (have outputs + JS)
    display_names: display-only spreadsheets (no outputs, XML only)
    """
    now = datetime.now(timezone.utc).isoformat()

    spreadsheets = {}
    functions = {}

    for name in sorted(func_names | display_names):
        entry = registry.get(name)
        if not entry:
            continue

        uid = entry["uuid"]
        sheet_type = entry.get("sheetType", "standard")
        # Map sheetType for manifest format
        manifest_type = "loop" if sheet_type == "loop" else "standard"
        manifest_func_type = "loop" if sheet_type == "loop" else "spreadsheet"

        description = entry.get("description", "")

        spreadsheets[f"local-{uid}"] = {
            "name": name,
            "description": description,
            "type": manifest_type,
            "folderId": None,
            "createdAt": now,
            "updatedAt": now,
        }

        # Only callable functions go in the functions section
        if name in func_names:
            functions[uid] = {
                "name": name,
                "description": description,
                "version": "1.0",
                "sheetType": manifest_func_type,
                "folderId": None,
            }

    return {
        "version": "1.0",
        "packageId": str(uuid.uuid4()),
        "exportedAt": now,
        "folders": {},
        "spreadsheets": spreadsheets,
        "functions": functions,
    }


def main():
    parser = argparse.ArgumentParser(description="Export workfolder to frontend-importable zip")
    parser.add_argument("--workfolder", required=True, help="Path to workfolder directory")
    parser.add_argument("--output", "-o", help="Output zip path (default: auto-named in examples/)")
    parser.add_argument("functions", nargs="*", help="Specific functions to export (default: all)")

    args = parser.parse_args()
    workfolder_dir = args.workfolder

    registry = load_registry(workfolder_dir)

    if not registry:
        print("Error: Registry is empty", file=sys.stderr)
        sys.exit(1)

    # Determine which functions to export
    if args.functions:
        func_names = {name.upper() for name in args.functions}
        # Include transitive deps
        func_names = resolve_transitive_deps(func_names, registry)
    else:
        func_names = set(registry.keys())

    # Separate callable functions from display-only sheets
    display_names = set()
    callable_names = set()
    not_in_registry = []
    for name in sorted(func_names):
        entry = registry.get(name)
        if not entry:
            not_in_registry.append(name)
            continue
        xml_path = os.path.join(workfolder_dir, entry["xml"])
        if not os.path.exists(xml_path):
            not_in_registry.append(f"{name} (missing {entry['xml']})")
            continue
        if is_display_only(xml_path):
            display_names.add(name)
        else:
            callable_names.add(name)

    if not_in_registry:
        print("Error: Not found:", file=sys.stderr)
        for item in not_in_registry:
            print(f"  {item}", file=sys.stderr)
        sys.exit(1)

    # Validate: callable functions need XML + JS, display sheets need only XML
    missing = []
    for name in sorted(callable_names):
        entry = registry.get(name)
        if not entry:
            missing.append(f"{name}: not in registry")
            continue
        xml_path = os.path.join(workfolder_dir, entry["xml"])
        js_path = os.path.join(workfolder_dir, entry["js"])
        if not os.path.exists(xml_path):
            missing.append(f"{name}: missing {entry['xml']}")
        if not os.path.exists(js_path):
            missing.append(f"{name}: missing {entry['js']} (run transpile.py first)")

    for name in sorted(display_names):
        entry = registry.get(name)
        if not entry:
            missing.append(f"{name}: not in registry")
            continue
        xml_path = os.path.join(workfolder_dir, entry["xml"])
        if not os.path.exists(xml_path):
            missing.append(f"{name}: missing {entry['xml']}")

    if missing:
        print("Error: Missing files:", file=sys.stderr)
        for m in missing:
            print(f"  {m}", file=sys.stderr)
        sys.exit(1)

    # Build manifest
    manifest = build_manifest(callable_names, display_names, registry)

    # Determine output path
    if args.output:
        zip_path = args.output
    else:
        workfolder_name = os.path.basename(os.path.normpath(workfolder_dir))
        zip_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "examples")
        os.makedirs(zip_dir, exist_ok=True)
        zip_path = os.path.join(zip_dir, f"{workfolder_name}.zip")

    # Create zip
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        # Callable functions: XML + JS in functions/, XML in spreadsheets/
        for name in sorted(callable_names):
            entry = registry[name]
            uid = entry["uuid"]

            xml_path = os.path.join(workfolder_dir, entry["xml"])
            js_path = os.path.join(workfolder_dir, entry["js"])

            zf.write(xml_path, f"functions/{uid}.xml")
            zf.write(js_path, f"functions/{uid}.js")
            zf.write(xml_path, f"spreadsheets/local-{uid}.xml")

        # Display-only sheets: XML in spreadsheets/ only
        for name in sorted(display_names):
            entry = registry[name]
            uid = entry["uuid"]

            xml_path = os.path.join(workfolder_dir, entry["xml"])
            zf.write(xml_path, f"spreadsheets/local-{uid}.xml")

        # manifest.json
        zf.writestr("manifest.json", json.dumps(manifest, indent=2))

    total = len(callable_names) + len(display_names)
    parts = [f"{len(callable_names)} function(s)"]
    if display_names:
        parts.append(f"{len(display_names)} display sheet(s)")
    print(f"Exported {' + '.join(parts)} → {zip_path}")


if __name__ == "__main__":
    main()
