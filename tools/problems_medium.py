import string
from seedlib import P, A, arr_case

def rarr(r, n, lo, hi):
    return [r.randint(lo, hi) for _ in range(n)]

def word(r, n, alpha='abcdefghijklmnopqrstuvwxyz'):
    return ''.join(r.choice(alpha) for _ in range(n))

P('medium', 'Arrays', 'Second Largest Distinct Element',
  "Given an array of integers, print the second largest *distinct* value. If the array has fewer than two distinct values, print -1.",
  "Line 1: N. Line 2: N integers.", "One integer: the second largest distinct value, or -1.",
  "1 <= N <= 10^5, -10^9 <= a[i] <= 10^9",
  ["5\n4 9 9 2 7\n", "3\n5 5 5\n"],
  lambda r: ["1\n42\n", "2\n1 2\n", "6\n-1 -1 -2 -2 -3 -3\n", arr_case(rarr(r, 1000, -10**9, 10**9)), arr_case(rarr(r, 20000, -5, 5)),
             "4\n1000000000 -1000000000 1000000000 0\n"],
  "input()\ns=sorted(set(map(int,input().split())),reverse=True)\nprint(s[1] if len(s)>1 else -1)")

P('medium', 'Strings', 'Reverse the Words',
  "Read a sentence of words separated by single spaces and print the words in reverse order (the words themselves stay unchanged).",
  "One line: words made of letters, separated by single spaces.", "The words in reverse order, separated by single spaces.",
  "1 <= length of line <= 10^4",
  ["hello world from code rush\n", "single\n"],
  lambda r: [" ".join(word(r, r.randint(1, 8)) for _ in range(r.randint(2, 6))) + "\n" for _ in range(4)]
            + [" ".join(word(r, r.randint(1, 10)) for _ in range(900)) + "\n", "a b\n"],
  "print(' '.join(input().split()[::-1]))")

P('medium', 'Strings', 'Valid Palindrome',
  "Read a line of text. Ignoring case and every character that is not a letter or a digit, decide whether the text reads the same forwards and backwards. Print YES or NO. A line with no letters or digits counts as a palindrome.",
  "One line of printable ASCII characters.", "YES or NO.",
  "1 <= length <= 10^5",
  ["A man, a plan, a canal: Panama\n", "race a car\n"],
  lambda r: ["!!! ???\n", "No 'x' in Nixon\n", "0P\n", "Was it a car or a cat I saw?\n", "ab\n",
             (lambda h: h + "x" + h[::-1] + "\n")(word(r, 30000, string.ascii_letters + string.digits)),
             (lambda h: h + "xy" + h[::-1] + "\n")(word(r, 20000, string.ascii_letters))],
  "s=[c.lower() for c in input() if c.isalnum()]\nprint('YES' if s==s[::-1] else 'NO')")

def bs_case(r, n, q, lo=-10**9, hi=10**9):
    a = sorted(r.sample(range(lo, hi), n)) if hi - lo > n * 3 else list(range(lo, lo + n))
    qs = [r.choice(a) if r.random() < .5 else r.randint(lo, hi) for _ in range(q)]
    return f"{n}\n{A(a)}\n{q}\n{A(qs)}\n"

P('medium', 'Searching', 'Binary Search Queries',
  "You are given a sorted array of distinct integers and several queries. For each query print the 0-based index of the value in the array, or -1 if it is not present.",
  "Line 1: N. Line 2: N integers in strictly increasing order. Line 3: Q. Line 4: Q integers (the queries).",
  "Q lines, one answer per query, in order.",
  "1 <= N, Q <= 10^5, values fit in 32-bit signed integers.",
  ["5\n1 3 5 7 9\n3\n7 4 1\n"],
  lambda r: ["1\n5\n2\n5 6\n", "3\n-10 0 10\n4\n-10 10 0 11\n", bs_case(r, 50, 30, -100, 100), bs_case(r, 20000, 20000), bs_case(r, 2, 5, 0, 1)],
  "n=int(input());a=list(map(int,input().split()));q=int(input())\nd={v:i for i,v in enumerate(a)}\nfor x in map(int,input().split()): print(d.get(x,-1))")

P('medium', 'Sorting', 'Sort the Array',
  "Sort the given integers in non-decreasing order and print them on one line separated by spaces.",
  "Line 1: N. Line 2: N integers.", "The sorted integers separated by spaces.",
  "1 <= N <= 10^5, -10^9 <= a[i] <= 10^9",
  ["5\n5 2 9 1 5\n"],
  lambda r: ["1\n0\n", "4\n4 3 2 1\n", "6\n-5 -5 0 0 3 3\n", arr_case(rarr(r, 30000, -10**9, 10**9)), arr_case(rarr(r, 5000, 0, 3)), arr_case(list(range(3000, 0, -1)))],
  "input()\nprint(*sorted(map(int,input().split())))")

P('medium', 'Strings', 'Most Frequent Character',
  "Given a string of lowercase letters print the letter that occurs most often followed by how many times it occurs. If several letters tie, print the alphabetically smallest one.",
  "One line: a string of lowercase letters.", "The letter, a space, and its count.",
  "1 <= length <= 10^5",
  ["mississippi\n", "abcabc\n"],
  lambda r: ["z\n", "zzyy\n", word(r, 50000) + "\n", word(r, 30, 'abc') + "\n", "abcdefghijklmnopqrstuvwxyz\n", word(r, 200, 'xyz') + "\n"],
  "from collections import Counter\nc=Counter(input().strip())\nm=max(c.values())\nk=min(x for x in c if c[x]==m)\nprint(k,m)")

P('medium', 'Arrays', 'Rotate Array Right',
  "Rotate the array to the right by K positions (each step moves the last element to the front) and print the result.",
  "Line 1: N and K. Line 2: N integers.", "The rotated array separated by spaces.",
  "1 <= N <= 10^5, 0 <= K <= 10^9, -10^9 <= a[i] <= 10^9",
  ["5 2\n1 2 3 4 5\n", "3 3\n7 8 9\n"],
  lambda r: ["1 1000000000\n5\n", "4 0\n1 2 3 4\n", "6 13\n1 2 3 4 5 6\n", "5 1000000000\n9 8 7 6 5\n",
             (lambda a: f"{len(a)} {r.randint(0,10**9)}\n{A(a)}\n")(rarr(r, 20000, -10**9, 10**9))],
  "n,k=map(int,input().split());a=input().split();k%=n\nprint(*(a[-k:]+a[:-k] if k else a))")

def two_sum_case(r, n):
    """Constructive: no other pair can sum to t because every added value blocks its own complement."""
    t = r.randint(-10**6, 10**6)
    while True:
        p = r.randint(-10**6, 10**6); q = t - p
        if p != q: break
    used = {p, q}
    while len(used) < n:
        y = r.randint(-10**6, 10**6)
        if y in used or (t - y) in used or 2 * y == t: continue
        used.add(y)
    a = sorted(used); r.shuffle(a)
    return f"{n} {t}\n{A(a)}\n"

P('medium', 'Searching', 'Two Sum Indices',
  "Given an array of distinct integers and a target T, there is exactly one pair of positions i < j with a[i] + a[j] = T. Print i and j (0-based).",
  "Line 1: N and T. Line 2: N distinct integers.", "Two integers i and j with i < j.",
  "2 <= N <= 10^4, values fit in 32-bit signed integers. Exactly one valid pair exists.",
  ["4 9\n2 7 11 15\n", "3 6\n3 2 4\n"],
  lambda r: ["2 3\n1 2\n", "5 -3\n-5 2 8 -1 0\n", two_sum_case(r, 10), two_sum_case(r, 200), two_sum_case(r, 3000), two_sum_case(r, 10000)],
  "n,t=map(int,input().split());a=list(map(int,input().split()));seen={}\nfor j,x in enumerate(a):\n    if t-x in seen: print(seen[t-x],j);break\n    seen[x]=j")

P('medium', 'Strings', 'Anagram Check',
  "Two words are anagrams if one can be rearranged into the other using every letter exactly once. Decide whether the two given words are anagrams.",
  "Two lines, each a word of lowercase letters.", "YES or NO.",
  "1 <= length <= 10^5 per word",
  ["listen\nsilent\n", "apple\npaddle\n"],
  lambda r: ["a\na\n", "ab\nabc\n", "abc\nabd\n", (lambda w: w + "\n" + "".join(sorted(w)) + "\n")(word(r, 40000)),
             (lambda w: w + "\n" + w[:-1] + ("a" if w[-1] != "a" else "b") + "\n")(word(r, 5000))],
  "a=input().strip();b=input().strip()\nprint('YES' if sorted(a)==sorted(b) else 'NO')")

def missing_case(r, n):
    a = list(range(1, n + 1)); m = r.choice(a); a.remove(m); r.shuffle(a)
    return f"{n}\n{A(a)}\n"

P('medium', 'Logic', 'Missing Number',
  "An array contains N-1 distinct integers taken from 1..N in random order. Exactly one number from 1..N is missing. Find it.",
  "Line 1: N. Line 2: the N-1 integers.", "The missing integer.",
  "2 <= N <= 10^6",
  ["5\n3 1 5 2\n"],
  lambda r: ["2\n1\n", "2\n2\n", missing_case(r, 10), missing_case(r, 1000), missing_case(r, 50000), "6\n1 2 3 4 5\n", "6\n2 3 4 5 6\n"],
  "n=int(input());print(n*(n+1)//2-sum(map(int,input().split())))")

P('medium', 'Arrays', 'Merge Two Sorted Arrays',
  "Merge two arrays that are each sorted in non-decreasing order into one sorted array.",
  "Line 1: N and M. Line 2: N integers. Line 3: M integers.", "The merged array separated by spaces.",
  "1 <= N, M <= 10^5, -10^9 <= values <= 10^9",
  ["3 4\n1 4 9\n2 3 10 11\n"],
  lambda r: ["1 1\n5\n5\n", "2 3\n1 2\n3 4 5\n", "3 2\n10 20 30\n-5 0\n",
             (lambda a, b: f"{len(a)} {len(b)}\n{A(a)}\n{A(b)}\n")(sorted(rarr(r, 15000, -10**9, 10**9)), sorted(rarr(r, 12000, -10**9, 10**9))),
             (lambda a, b: f"{len(a)} {len(b)}\n{A(a)}\n{A(b)}\n")(sorted(rarr(r, 50, -3, 3)), sorted(rarr(r, 50, -3, 3)))],
  "input();a=list(map(int,input().split()));b=list(map(int,input().split()))\nprint(*sorted(a+b))")

P('medium', 'Arrays', 'Remove Duplicates Keeping Order',
  "Print the array with every repeated value removed, keeping only the first occurrence of each value and preserving the original order.",
  "Line 1: N. Line 2: N integers.", "The remaining values separated by spaces.",
  "1 <= N <= 10^5, -10^9 <= a[i] <= 10^9",
  ["7\n4 5 4 6 5 7 4\n"],
  lambda r: ["1\n9\n", "5\n1 1 1 1 1\n", "5\n5 4 3 2 1\n", arr_case(rarr(r, 20000, -100, 100)), arr_case(rarr(r, 20000, -10**9, 10**9)), "6\n-1 -1 0 0 -1 0\n"],
  "input();seen=set();o=[]\nfor x in input().split():\n    if x not in seen: seen.add(x);o.append(x)\nprint(*o)")

P('medium', 'Functions', 'GCD and LCM',
  "Read two positive integers and print their greatest common divisor and least common multiple.",
  "One line with integers A and B.", "Two integers: GCD and LCM separated by a space.",
  "1 <= A, B <= 10^9 (the LCM can be as large as 10^18).",
  ["12 18\n", "7 13\n"],
  lambda r: ["1 1\n", "1000000000 1000000000\n", "999999937 999999929\n", "1000000000 1\n", "48 180\n", f"{r.randint(1,10**9)} {r.randint(1,10**9)}\n"],
  "import math\na,b=map(int,input().split());g=math.gcd(a,b);print(g,a//g*b)")

P('medium', 'Logic', 'Count Primes',
  "Count how many prime numbers are less than or equal to N.",
  "One line with an integer N.", "One integer: the number of primes <= N.",
  "1 <= N <= 10^6",
  ["10\n", "100\n"],
  lambda r: ["1\n", "2\n", "3\n", "1000000\n", "999983\n", "500000\n", "97\n"],
  "n=int(input())\ns=bytearray([1])*(n+1)\ns[0]=0\nif n>=1:s[1]=0\nfor i in range(2,int(n**.5)+1):\n    if s[i]: s[i*i::i]=bytearray(len(s[i*i::i]))\nprint(sum(s))")

def caesar_case(r):
    t = ''.join(r.choice(string.ascii_letters + '     ,.!?0123456789') for _ in range(r.randint(20, 300)))
    return f"{r.randint(0, 10**9)}\n{t.strip() or 'x'}\n"

P('medium', 'Strings', 'Caesar Cipher',
  "Shift every letter of the text forward in the alphabet by K positions, wrapping from z back to a. Upper-case letters stay upper-case, lower-case stay lower-case and all other characters are unchanged.",
  "Line 1: K. Line 2: the text.", "The encrypted text.",
  "0 <= K <= 10^9, 1 <= length of text <= 1000",
  ["3\nHello, World!\n", "26\nabc XYZ\n"],
  lambda r: ["0\nunchanged 123\n", "1\nzZ\n", "13\nThe Quick Brown Fox\n", "1000000000\nAbc xyz\n", caesar_case(r), caesar_case(r)],
  "k=int(input())%26;t=input();o=[]\nfor c in t:\n    if 'a'<=c<='z': o.append(chr((ord(c)-97+k)%26+97))\n    elif 'A'<=c<='Z': o.append(chr((ord(c)-65+k)%26+65))\n    else: o.append(c)\nprint(''.join(o))")

def matrix_case(r, n, lo=-1000, hi=1000):
    return f"{n}\n" + "\n".join(A(rarr(r, n, lo, hi)) for _ in range(n)) + "\n"

P('medium', 'Arrays', 'Matrix Diagonals',
  "Given an N x N matrix print the sum of the main diagonal (top-left to bottom-right) and the sum of the anti-diagonal (top-right to bottom-left).",
  "Line 1: N. Then N lines with N integers each.", "Two integers: main diagonal sum and anti-diagonal sum.",
  "1 <= N <= 500, -1000 <= values <= 1000",
  ["3\n1 2 3\n4 5 6\n7 8 9\n"],
  lambda r: ["1\n5\n", "2\n1 2\n3 4\n", matrix_case(r, 5), matrix_case(r, 50), matrix_case(r, 300), matrix_case(r, 4, 1000, 1000)],
  "n=int(input());m=[list(map(int,input().split())) for _ in range(n)]\nprint(sum(m[i][i] for i in range(n)),sum(m[i][n-1-i] for i in range(n)))")

def brackets(r, n, ok):
    pairs = {'(': ')', '[': ']', '{': '}'}
    st = []; out = []
    for _ in range(n):
        if st and r.random() < .5:
            out.append(pairs[st.pop()])
        else:
            o = r.choice('([{'); st.append(o); out.append(o)
    out += [pairs[o] for o in reversed(st)]
    s = ''.join(out)
    if not ok and len(s) > 1:
        i = r.randrange(len(s)); s = s[:i] + r.choice('()[]{}') + s[i+1:]
    return s + "\n"

P('medium', 'Logic', 'Balanced Brackets',
  "A string made only of the characters ( ) [ ] { } is balanced if every opening bracket is closed by the matching bracket in the correct order. Decide whether the string is balanced.",
  "One line with the string.", "YES or NO.",
  "1 <= length <= 10^5",
  ["([]{})\n", "([)]\n"],
  lambda r: ["(\n", ")(\n", "((()))\n", "{[()]}[]\n", brackets(r, 20, True), brackets(r, 20, False), brackets(r, 30000, True), brackets(r, 30000, False)],
  "s=input().strip();st=[];m={')':'(',']':'[','}':'{'};ok=True\nfor c in s:\n    if c in '([{': st.append(c)\n    elif not st or st.pop()!=m[c]: ok=False;break\nprint('YES' if ok and not st else 'NO')")

P('medium', 'Arrays', 'Maximum Subarray Sum',
  "Find the largest possible sum of a non-empty contiguous subarray.",
  "Line 1: N. Line 2: N integers.", "One integer: the maximum subarray sum.",
  "1 <= N <= 10^5, -10^4 <= a[i] <= 10^4",
  ["8\n-2 1 -3 4 -1 2 1 -5\n", "3\n-4 -2 -9\n"],
  lambda r: ["1\n-7\n", "1\n5\n", "5\n1 2 3 4 5\n", arr_case(rarr(r, 20000, -10**4, 10**4)), arr_case(rarr(r, 20000, -10**4, -1)), arr_case([10**4] * 10000)],
  "input();best=cur=None\nfor x in map(int,input().split()):\n    cur=x if cur is None or cur<0 else cur+x\n    best=cur if best is None or cur>best else best\nprint(best)")

P('medium', 'Sorting', 'Sort by Frequency',
  "Sort the array so that values appearing more often come first. Values with equal frequency are ordered from smaller to larger. Print the sorted array (every occurrence is kept).",
  "Line 1: N. Line 2: N integers.", "The reordered array separated by spaces.",
  "1 <= N <= 10^5, -10^9 <= a[i] <= 10^9",
  ["8\n4 5 6 5 4 3 4 5\n", "5\n1 2 3 4 5\n"],
  lambda r: ["1\n7\n", "6\n2 2 1 1 3 3\n", arr_case(rarr(r, 20000, -30, 30)), arr_case(rarr(r, 20000, -10**9, 10**9)), "7\n-1 -1 5 5 5 0 0\n"],
  "from collections import Counter\ninput();a=list(map(int,input().split()));c=Counter(a)\nprint(*sorted(a,key=lambda x:(-c[x],x)))")

P('medium', 'Strings', 'Run-Length Encoding',
  "Compress a string by replacing every run of the same letter with the letter followed by the length of the run. For example aaabbc becomes a3b2c1.",
  "One line: a string of lowercase letters.", "The encoded string.",
  "1 <= length <= 10^5",
  ["aaabbc\n", "abc\n"],
  lambda r: ["z\n", "zzzzzzzzzzzz\n", "aabbaabb\n", ''.join(c * r.randint(1, 40) for c in word(r, 3000, 'abcd')) + "\n", "a" * 100000 + "\n", word(r, 20000, 'ab') + "\n"],
  "import itertools\nprint(''.join(k+str(len(list(g))) for k,g in itertools.groupby(input().strip())))")
