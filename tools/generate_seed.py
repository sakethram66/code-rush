#!/usr/bin/env python3
"""Regenerates seed/questions.json (and tests/fixtures/reference_solutions.json).

    python3 tools/generate_seed.py

Expected outputs are produced by running each problem's reference solution, so they are always consistent.
Generation is deterministic (seeded per title), so the committed JSON only changes when a problem changes.
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
import seedlib
import problems_easy, problems_medium, problems_hard  # noqa: F401  (registers problems on import)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

if __name__ == '__main__':
    data = seedlib.build()
    counts = {d: sum(1 for q in data if q['difficulty'] == d) for d in ('easy', 'medium', 'hard')}
    print('Problems:', counts, file=sys.stderr)
    os.makedirs(os.path.join(ROOT, 'seed'), exist_ok=True)
    os.makedirs(os.path.join(ROOT, 'tests', 'fixtures'), exist_ok=True)
    with open(os.path.join(ROOT, 'seed', 'questions.json'), 'w') as f:
        json.dump(data, f, separators=(',', ':'))
    with open(os.path.join(ROOT, 'tests', 'fixtures', 'reference_solutions.json'), 'w') as f:
        json.dump(seedlib.REF_SOLUTIONS, f, indent=1)
    size = os.path.getsize(os.path.join(ROOT, 'seed', 'questions.json'))
    print(f'Wrote seed/questions.json ({size/1e6:.1f} MB)', file=sys.stderr)
