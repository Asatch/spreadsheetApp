# SC-Spreadsheet Development Guidelines

## What This Is
A spreadsheet app for approachable, interactive code development. Spreadsheets transpile into callable functions, letting you view values flow through operations. Supports standard and loop workflow types.

Project structure: `/src` (UI, client-side transpiler, storage) and `/function-workshop` (CLI tools for building/testing functions).

## How We Work

### Core Principles
- **Approval before changes** - Summarize what you'll change, explain the approach, wait for explicit approval
- **Understand before acting** - Read the relevant code, understand the context of how the relevant parts work inside the larger system, don't guess
- **Evidence-based decisions** - Base decisions on code analysis, logs, and observed behavior
- **Keep docs current** - Update project docs after significant progress (what was done, how to verify, next steps)

### Problem-Solving Approach

**1. Understand the problem**
- Investigate how the code in question works, and how it interacts with the larger system
- For bugs:
  - Identify root cause—examine data flows, edge cases
  - If unclear, think about the problem systematically--identify the flow the code goes through, which different parts all contribute to the answer, and could therefore possibly be contributing to the bug. Think about how to narrow it down, with diagnostics and tests.
  - Confirm the hypothesized cause would actually produce the observed behavior before moving on
- For enhancements: restate goals, identify integration points, consider how it fits the architecture--Is it worth it?

**2. Plan the solution**
- For bugs: once confirmed, explain how the fix addresses the root cause directly
- For enhancements: document what changes where, consider design trade-offs, think about how to do it well (not just minimally)
- For all medium+ changes: create a plan document for review

**3. Get approval**
- Present your plan, highlight any architectural decisions or trade-offs versus other courses of action
- Wait for explicit go-ahead

**4. Implement**
- For bugs: keep changes focused on the fix, include regression tests
- For enhancements: implement in logical phases, provide checkpoints for review
- Test appropriately throughout

## General Principles

- Before proposing abstractions or new patterns, prefer the simplest approach first. Ask whether a simpler raw approach would suffice for the goals being pursued before building unnecessary layers.

## Architectural Principles

### Code Goals
Aim for code that is:
- **Maintainable** - the primary goal
- **Performant** - at bottlenecks, not prematurely everywhere

Maintainability means:
- **Readability** - clear intent, easy to follow
- **Fast, loud failures** - fail early and obviously rather than silently corrupting
- **Separation of concerns** - distinct responsibilities in distinct places
- **Avoid semantic duplication** - don't repeat the same concept in multiple places (where reasonable)
- **Composition** - build from smaller, composable pieces (where reasonable)
- **Testability and Debuggability** - code that can be verified, and issues traced to their sources

### Frontend Architecture
- **Factory Pattern + DI**: State-managing functions live inside factory patterns requiring explicit dependency injection. This enforces strict state management.
- **Semantic Domains**:
  - **Engines** - manage non-UI state domains
  - **Components** - manage UI state
  - **Orchestrator** - wires dependencies, handles cross-cutting operations
  - **Utilities** - stateless logic only
- **State Ownership**: Think carefully about where code belongs. State-mutating functions must not be generally accessible via imports.
- **Cohesion**: Group semantically related actions together:
  - At the module level: operations of the same domain belong in the same module
  - At the function level: compose related steps into named functions rather than scattering inline

### Generated Files
- **`index.html` and `loop.html`** are auto-generated from `scripts/generate-html.js`
- Do not edit these HTML files directly—edit the generator script instead

## Key Concepts

### Spreadsheets as Functions
The core idea: a spreadsheet isn't just a grid of calculations—it's a **function** that can be called from other spreadsheets. You define inputs, build calculations that reference them, and mark outputs. The spreadsheet becomes a reusable, inspectable computation.

### Standard vs Loop Sheets
Two spreadsheet types with different entry points:

- **Standard sheets** - Traditional spreadsheet model. Values flow through cells based on formulas. Good for straightforward input→calculation→output flows.
- **Loop sheets** - For iterative/recursive computations. Supports extracting iteration patterns into a DAG structure for transpilation. Used when the calculation needs to loop over data.

### Inputs and Outputs
The Inputs/Outputs panels turn a spreadsheet into a callable interface:
- **Inputs** - Named values that feed into the spreadsheet. Referenced in formulas by name.
- **Outputs** - Cells marked as outputs become the function's return values.

This allows treating the spreadsheet as `outputs = f(inputs)`.

### Custom Functions
Spreadsheets can call other spreadsheets as functions:
1. A spreadsheet is exported to XML
2. The client-side transpiler converts it to JavaScript
3. The transpiled JS is registered and stored locally (OPFS)
4. It becomes available as a function in formulas (e.g., `=MY_FUNCTION(A1, B1)`)

### Drilldown
**Ctrl+D** on a cell containing a custom function call opens that function's spreadsheet in a new tab. This lets you inspect how a function works—see the inputs flow through, understand the calculation, debug issues. The computation becomes transparent rather than a black box.

### Publishing Flow
```
Spreadsheet → Export to XML → Client-side transpiler → JavaScript
                                       ↓
                                Stored locally (OPFS)
                                       ↓
                           Available as custom function
```

## Quick Start

```bash
NO_COLOR=1 npm run dev
```
Runs on https://localhost:3001

## Quick Reference

### Frontend Commands
| Command | Purpose |
|---------|---------|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run lint` | Run linter |
| `npm run test` | Run Vitest tests |
| `npm run test:e2e` | Run Playwright tests |

### Function Workshop Commands
| Command | Purpose |
|---------|---------|
| `node function-workshop/eval.mjs test <file.xml>` | Run XML test cases |
| `node function-workshop/eval.mjs evaluate <file.xml> '[inputs]'` | Evaluate XML with inputs |

## Project Structure
```
├── src/                   # UI, client-side transpiler, storage (OPFS)
│   └── transpiler/        # XML → JavaScript transpilation
├── scripts/               # Build scripts (e.g. generate-html.js)
├── function-workshop/     # CLI tools for building, testing, and packaging functions
```

## Project Contexts (p1-pN)

Use `/p <N>` to load a project context.

**Work order: highest to lowest.** Start with the highest p number and work down. Lower numbers are more foundational/blocked.

Check `.claude/contexts/` for active projects. When done:
1. **Get user confirmation** - Don't assume a project is complete; ask the user to confirm
2. Mark project doc complete, commit
3. Delete project doc and context reference, commit
4. Move to next project down

## Docs Repo

Project documentation lives in a companion `sc-docs` repo (sibling directory). This repo is branchless — always commit to main, always push.

**Always commit and push docs changes immediately.** When you create, edit, or delete a file in the docs repo, commit and push to origin right away. No batching, no waiting. The docs repo should always be in sync so all contributors (Matthew, Asa) see changes immediately.

**If the docs repo is missing or inaccessible:** Warn the user. The expected location is `../sc-docs/` relative to the main worktree root (for git worktrees, resolve to the main worktree's sibling). If it's not there, tell the user and offer to help clone/set it up:
```
git clone https://github.com/mathMatthew/sc-docs.git ../sc-docs
```

## Git
- **No co-author lines** - Never add `Co-Authored-By: Claude` or similar to commit messages
- **Always `git fetch` before checking remote state** - Never rely on stale local refs. When checking whether a branch exists on the remote, whether work has been pushed, or what's on origin/main, always fetch first.
