"""Helpers for building the seed question bank.

Every problem carries a reference solution (a stdin->stdout Python program). Expected outputs are
produced by *running* that program, so test data can never disagree with the reference.
"""
import hashlib, os, random, subprocess, sys, tempfile, time

REGISTRY = []
REF_SOLUTIONS = {}   # title -> python source (used by the integration test-suite)


def A(a):
    return ' '.join(map(str, a))


def arr_case(a):
    return f"{len(a)}\n{A(a)}\n"


def P(difficulty, topic, title, statement, input_format, output_format, constraints, samples, gen, sol, tl=2000):
    REGISTRY.append(dict(difficulty=difficulty, topic=topic, title=title, statement=statement.strip(),
                         input_format=input_format.strip(), output_format=output_format.strip(),
                         constraints=constraints.strip(), samples=samples, gen=gen, sol=sol.strip() + "\n", tl=tl))


def _run(path, data, timeout=30):
    t = time.time()
    r = subprocess.run([sys.executable, path], input=data.encode(), capture_output=True, timeout=timeout)
    if r.returncode != 0:
        raise RuntimeError(f"reference failed: {r.stderr.decode()[-400:]}")
    return r.stdout.decode(), time.time() - t


def build(problems=None):
    problems = problems or REGISTRY
    out = []
    seen_titles = set()
    with tempfile.TemporaryDirectory() as d:
        for p in problems:
            key = (p['title'].lower(), p['difficulty'])
            assert key not in seen_titles, f"duplicate title {p['title']}"
            seen_titles.add(key)
            path = os.path.join(d, 'sol.py')
            open(path, 'w').write(p['sol'])
            rng = random.Random(int(hashlib.md5(p['title'].encode()).hexdigest()[:8], 16))
            hidden = p['gen'](rng)
            inputs = [(s, True) for s in p['samples']] + [(h, False) for h in hidden]
            assert len({i for i, _ in inputs}) == len(inputs), f"{p['title']}: duplicate test inputs"
            tests = []; worst = 0
            for inp, is_sample in inputs:
                assert inp.endswith("\n"), f"{p['title']}: input must end with newline"
                res, dt = _run(path, inp)
                worst = max(worst, dt)
                assert res.strip(), f"{p['title']}: empty output"
                tests.append(dict(input=inp, output=res, sample=is_sample))
            assert worst < 4.0, f"{p['title']}: reference too slow ({worst:.1f}s)"
            print(f"  [{p['difficulty']:6}] {p['title']:<42} tests={len(tests):2} ref_max={worst:.2f}s", file=sys.stderr)
            REF_SOLUTIONS[p['title']] = p['sol']
            out.append(dict(title=p['title'], difficulty=p['difficulty'], topic=p['topic'], statement=p['statement'],
                            input_format=p['input_format'], output_format=p['output_format'],
                            constraints_text=p['constraints'], time_limit_ms=p['tl'], memory_limit_mb=256, tests=tests))
    return out
