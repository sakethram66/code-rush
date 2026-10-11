import string
from seedlib import P, A, arr_case

def rarr(r, n, lo, hi):
    return [r.randint(lo, hi) for _ in range(n)]

def word(r, n, alpha='abcdefghijklmnopqrstuvwxyz'):
    return ''.join(r.choice(alpha) for _ in range(n))

# ---------------------------------------------------------------- dynamic programming
P('hard', 'Dynamic programming', 'Longest Increasing Subsequence',
  "Find the length of the longest strictly increasing subsequence of the array (elements need not be adjacent).",
  "Line 1: N. Line 2: N integers.", "One integer: the length of the LIS.",
  "1 <= N <= 10^5, -10^9 <= a[i] <= 10^9. An O(N^2) solution is too slow.",
  ["6\n10 9 2 5 3 7\n", "4\n5 5 5 5\n"],
  lambda r: ["1\n1\n", "5\n1 2 3 4 5\n", "5\n5 4 3 2 1\n", arr_case(rarr(r, 2000, -50, 50)), arr_case(rarr(r, 100000, -10**9, 10**9)), arr_case(list(range(1, 60001)))],
  "import bisect\ninput();t=[]\nfor x in map(int,input().split()):\n    i=bisect.bisect_left(t,x)\n    if i==len(t): t.append(x)\n    else: t[i]=x\nprint(len(t))")

def knap(r, n, W, wmax, vmax):
    return f"{n} {W}\n" + "\n".join(f"{r.randint(1,wmax)} {r.randint(1,vmax)}" for _ in range(n)) + "\n"

P('hard', 'Dynamic programming', '0/1 Knapsack',
  "There are N items, each with a weight and a value. Choose a subset of items (each at most once) whose total weight does not exceed W so that the total value is as large as possible.",
  "Line 1: N and W. Then N lines: weight and value of each item.", "One integer: the maximum total value.",
  "1 <= N <= 100, 1 <= W <= 10^4, 1 <= weight <= W, 1 <= value <= 10^6",
  ["3 50\n10 60\n20 100\n30 120\n"],
  lambda r: ["1 5\n5 10\n", "2 3\n4 100\n5 200\n", knap(r, 10, 30, 15, 50), knap(r, 50, 1000, 300, 10**6), knap(r, 100, 10000, 5000, 10**6), knap(r, 100, 10000, 200, 1000)],
  "n,W=map(int,input().split());dp=[0]*(W+1)\nfor _ in range(n):\n    w,v=map(int,input().split())\n    for c in range(W,w-1,-1):\n        if dp[c-w]+v>dp[c]: dp[c]=dp[c-w]+v\nprint(dp[W])")

P('hard', 'Dynamic programming', 'Longest Common Subsequence',
  "Given two strings, find the length of their longest common subsequence (characters keep their relative order but need not be adjacent).",
  "Two lines, each a string of lowercase letters.", "One integer: the LCS length.",
  "1 <= length <= 1000 per string",
  ["abcde\nace\n", "abc\ndef\n"],
  lambda r: ["a\na\n", "abc\nabc\n", "aaaa\naa\n", word(r, 1000, 'ab') + "\n" + word(r, 1000, 'ab') + "\n", word(r, 800) + "\n" + word(r, 900) + "\n", "x\ny\n"],
  "a=input().strip();b=input().strip();p=[0]*(len(b)+1)\nfor ca in a:\n    c=[0]\n    for j,cb in enumerate(b): c.append(p[j]+1 if ca==cb else max(p[j+1],c[j]))\n    p=c\nprint(p[-1])")

P('hard', 'Dynamic programming', 'Edit Distance',
  "The edit distance between two strings is the minimum number of single-character insertions, deletions or replacements needed to turn the first string into the second. Compute it.",
  "Two lines, each a string of lowercase letters.", "One integer: the edit distance.",
  "1 <= length <= 1000 per string",
  ["kitten\nsitting\n", "abc\nabc\n"],
  lambda r: ["a\nb\n", "abc\n\n".replace("\n\n", "\nx\n"), "intention\nexecution\n", word(r, 1000, 'abc') + "\n" + word(r, 950, 'abc') + "\n", word(r, 500) + "\n" + word(r, 700) + "\n", "horse\nros\n"],
  "a=input().strip();b=input().strip();p=list(range(len(b)+1))\nfor i,ca in enumerate(a,1):\n    c=[i]\n    for j,cb in enumerate(b,1): c.append(min(p[j]+1,c[j-1]+1,p[j-1]+(ca!=cb)))\n    p=c\nprint(p[-1])")

P('hard', 'Dynamic programming', 'Minimum Coin Change',
  "You have unlimited coins of N different values. Find the minimum number of coins needed to make exactly the amount T, or print -1 if it is impossible.",
  "Line 1: N and T. Line 2: the N coin values.", "One integer: the minimum number of coins, or -1.",
  "1 <= N <= 30, 1 <= T <= 10^5, 1 <= coin <= 10^5",
  ["3 11\n1 2 5\n", "1 3\n2\n"],
  lambda r: ["1 1\n1\n", "3 100000\n1 7 99999\n", "2 100000\n3 6\n", "4 63\n1 5 10 21\n", "5 99999\n99991 4999 250 33 17\n",
             (lambda c: f"{len(c)} {r.randint(50000,100000)}\n{A(c)}\n")(r.sample(range(2, 2000), 25))],
  "n,t=map(int,input().split());c=list(map(int,input().split()));INF=10**9;dp=[0]+[INF]*t\nfor x in range(1,t+1):\n    m=INF\n    for v in c:\n        if v<=x and dp[x-v]+1<m: m=dp[x-v]+1\n    dp[x]=m\nprint(dp[t] if dp[t]<INF else -1)")

P('hard', 'Dynamic programming', 'Partition Equal Subset Sum',
  "Decide whether the array can be split into two groups (every element in exactly one group) with equal sums.",
  "Line 1: N. Line 2: N positive integers.", "YES or NO.",
  "1 <= N <= 200, 1 <= a[i] <= 100",
  ["4\n1 5 11 5\n", "4\n1 2 3 5\n"],
  lambda r: ["1\n2\n", "2\n3 3\n", arr_case(rarr(r, 200, 1, 100)), arr_case([100] * 199 + [99]), arr_case(rarr(r, 60, 1, 9)), arr_case([2 * x for x in rarr(r, 100, 1, 50)]), "3\n1 1 1\n"],
  "input();a=list(map(int,input().split()));s=sum(a)\nif s%2: print('NO')\nelse:\n    m=1\n    for x in a: m|=m<<x\n    print('YES' if (m>>(s//2))&1 else 'NO')")

def jobs(r, n):
    out = []
    for _ in range(n):
        s = r.randint(0, 10**6); out.append(f"{s} {s + r.randint(1, 5000)} {r.randint(1, 10**4)}")
    return f"{n}\n" + "\n".join(out) + "\n"

P('hard', 'Dynamic programming', 'Weighted Job Scheduling',
  "There are N jobs, each with a start time, an end time and a profit. You can work on one job at a time; a job may start exactly when another ends. Choose non-overlapping jobs to maximise the total profit.",
  "Line 1: N. Then N lines: start end profit.", "One integer: the maximum total profit.",
  "1 <= N <= 10^5, 0 <= start < end <= 10^9, 1 <= profit <= 10^4",
  ["4\n1 3 50\n2 5 20\n4 6 70\n6 7 60\n"],
  lambda r: ["1\n0 1 5\n", "3\n1 2 10\n2 3 10\n3 4 10\n", "3\n1 10 5\n2 3 3\n3 4 3\n", jobs(r, 30), jobs(r, 3000), jobs(r, 30000)],
  "import bisect\nn=int(input());J=sorted((tuple(map(int,input().split())) for _ in range(n)),key=lambda j:j[1])\nends=[j[1] for j in J];dp=[0]*(n+1)\nfor i,(s,e,p) in enumerate(J,1):\n    k=bisect.bisect_right(ends,s,0,i-1)\n    dp[i]=max(dp[i-1],dp[k]+p)\nprint(dp[n])")

# ---------------------------------------------------------------- graphs
def grid_case(r, h, w, p):
    return f"{h} {w}\n" + "\n".join(''.join('1' if r.random() < p else '0' for _ in range(w)) for _ in range(h)) + "\n"

P('hard', 'Graphs', 'Number of Islands',
  "A grid contains 1 (land) and 0 (water). An island is a maximal group of land cells connected horizontally or vertically. Count the islands.",
  "Line 1: R and C. Then R lines of C characters (0 or 1).", "One integer: the number of islands.",
  "1 <= R, C <= 500",
  ["4 5\n11000\n11000\n00100\n00011\n"],
  lambda r: ["1 1\n0\n", "1 1\n1\n", "2 2\n10\n01\n", grid_case(r, 30, 40, .45), grid_case(r, 300, 300, .5), grid_case(r, 400, 400, .3), "3 3\n111\n101\n111\n"],
  "R,C=map(int,input().split());g=[bytearray(input().strip(),'ascii') for _ in range(R)];n=0\nfor i in range(R):\n    for j in range(C):\n        if g[i][j]==49:\n            n+=1;st=[(i,j)];g[i][j]=48\n            while st:\n                x,y=st.pop()\n                for a,b in((x+1,y),(x-1,y),(x,y+1),(x,y-1)):\n                    if 0<=a<R and 0<=b<C and g[a][b]==49: g[a][b]=48;st.append((a,b))\nprint(n)")

def graph(r, n, m, wmax=10**6, connected=True, directed=False):
    es = set(); out = []
    if connected:
        for v in range(2, n + 1):
            u = r.randint(1, v - 1); es.add((u, v)); out.append((u, v, r.randint(1, wmax)))
    while len(out) < m:
        u, v = r.randint(1, n), r.randint(1, n)
        if u == v or (u, v) in es or (not directed and (v, u) in es): continue
        es.add((u, v)); out.append((u, v, r.randint(1, wmax)))
    r.shuffle(out)
    return out

def wg(n, es):
    return f"{n} {len(es)}\n" + "\n".join(f"{u} {v} {w}" for u, v, w in es) + "\n"

P('hard', 'Graphs', 'Shortest Path',
  "A network has N cities (numbered 1..N) and M bidirectional roads with lengths. Find the length of the shortest route from city 1 to city N, or -1 if no route exists.",
  "Line 1: N and M. Then M lines: u v w (a road of length w between u and v).", "One integer: the shortest distance, or -1.",
  "2 <= N <= 10^5, 1 <= M <= 2*10^5, 1 <= w <= 10^6",
  ["4 4\n1 2 5\n2 4 5\n1 3 1\n3 4 20\n", "3 1\n1 2 4\n"],
  lambda r: ["2 1\n1 2 7\n", "5 3\n1 2 1\n2 3 1\n4 5 1\n", wg(50, graph(r, 50, 120)), wg(2000, graph(r, 2000, 6000)), wg(30000, graph(r, 30000, 90000)),
             wg(1000, graph(r, 1000, 999, connected=True, wmax=10**6))],
  "import heapq\nn,m=map(int,input().split());g=[[] for _ in range(n+1)]\nfor _ in range(m):\n    u,v,w=map(int,input().split());g[u].append((v,w));g[v].append((u,w))\nINF=float('inf');d=[INF]*(n+1);d[1]=0;h=[(0,1)]\nwhile h:\n    x,u=heapq.heappop(h)\n    if x>d[u]: continue\n    for v,w in g[u]:\n        if x+w<d[v]: d[v]=x+w;heapq.heappush(h,(d[v],v))\nprint(d[n] if d[n]<INF else -1)")

P('hard', 'Graphs', 'Minimum Spanning Tree',
  "Cables must connect N offices. Given the possible cables with their costs, find the minimum total cost so that every office is connected to every other one (directly or indirectly), or print -1 if that is impossible.",
  "Line 1: N and M. Then M lines: u v w (a cable between u and v costing w).", "One integer: the minimum total cost, or -1.",
  "1 <= N <= 2*10^4, 0 <= M <= 10^5, 1 <= w <= 10^6",
  ["4 5\n1 2 1\n2 3 2\n3 4 3\n1 4 10\n1 3 5\n"],
  lambda r: ["1 0\n", "3 1\n1 2 5\n", "2 1\n1 2 9\n", wg(60, graph(r, 60, 150)), wg(5000, graph(r, 5000, 20000)), wg(20000, graph(r, 20000, 100000)),
             wg(40, graph(r, 40, 30, connected=False))],
  "n,m=map(int,input().split());E=sorted((tuple(map(int,input().split())) for _ in range(m)),key=lambda e:e[2]);p=list(range(n+1))\ndef f(x):\n    while p[x]!=x: p[x]=p[p[x]];x=p[x]\n    return x\nt=c=0\nfor u,v,w in E:\n    a,b=f(u),f(v)\n    if a!=b: p[a]=b;t+=w;c+=1\nprint(t if c==n-1 else -1)")

def dag(r, n, m):
    perm = list(range(1, n + 1)); r.shuffle(perm); es = set()
    while len(es) < m:
        i, j = sorted(r.sample(range(n), 2)); es.add((perm[i], perm[j]))
    es = list(es); r.shuffle(es)
    return f"{n} {len(es)}\n" + "\n".join(f"{u} {v}" for u, v in es) + "\n"

P('hard', 'Graphs', 'Smallest Topological Order',
  "There are N tasks numbered 1..N and M rules `u v` meaning task u must be done before task v. Print an order that satisfies every rule; if several orders exist print the lexicographically smallest one (compare the sequences number by number). If the rules contradict each other print IMPOSSIBLE.",
  "Line 1: N and M. Then M lines: u v.", "N task numbers separated by spaces, or IMPOSSIBLE.",
  "1 <= N <= 10^5, 0 <= M <= 2*10^5",
  ["4 3\n3 1\n4 1\n2 4\n", "3 3\n1 2\n2 3\n3 1\n"],
  lambda r: ["1 0\n", "3 0\n", "2 1\n2 1\n", dag(r, 40, 60), dag(r, 5000, 12000), dag(r, 30000, 90000), "5 5\n1 2\n2 3\n3 4\n4 2\n5 1\n"],
  "import heapq\nn,m=map(int,input().split());g=[[] for _ in range(n+1)];d=[0]*(n+1)\nfor _ in range(m):\n    u,v=map(int,input().split());g[u].append(v);d[v]+=1\nh=[i for i in range(1,n+1) if d[i]==0];heapq.heapify(h);o=[]\nwhile h:\n    u=heapq.heappop(h);o.append(u)\n    for v in g[u]:\n        d[v]-=1\n        if d[v]==0: heapq.heappush(h,v)\nprint(*o) if len(o)==n else print('IMPOSSIBLE')")

def paths_case(r, h, w, p):
    g = [''.join('#' if r.random() < p else '.' for _ in range(w)) for _ in range(h)]
    g[0] = '.' + g[0][1:]; g[-1] = g[-1][:-1] + '.'
    return f"{h} {w}\n" + "\n".join(g) + "\n"

P('hard', 'Dynamic programming', 'Grid Paths with Obstacles',
  "A robot starts at the top-left cell of a grid and wants to reach the bottom-right cell, moving only right or down. Cells marked # are blocked. Count the number of different paths modulo 1 000 000 007.",
  "Line 1: R and C. Then R lines of C characters: . (free) or # (blocked).", "One integer: the number of paths modulo 1000000007.",
  "1 <= R, C <= 500",
  ["3 3\n...\n.#.\n...\n"],
  lambda r: ["1 1\n.\n", "1 1\n#\n", "2 2\n.#\n#.\n", paths_case(r, 20, 20, .1), paths_case(r, 200, 300, .05), paths_case(r, 400, 400, .02), "3 4\n....\n....\n....\n", "500 500\n" + "\n".join("." * 500 for _ in range(500)) + "\n"],
  "R,C=map(int,input().split());M=10**9+7;g=[input().strip() for _ in range(R)];dp=[0]*C\nfor i in range(R):\n    for j in range(C):\n        if g[i][j]=='#': dp[j]=0\n        elif i==0 and j==0: dp[j]=1\n        else: dp[j]=((dp[j] if i else 0)+(dp[j-1] if j else 0))%M\nprint(dp[C-1]%M)")

# ---------------------------------------------------------------- arrays / stacks / windows
P('hard', 'Arrays', 'Count Inversions',
  "An inversion is a pair of positions i < j with a[i] > a[j]. Count the inversions in the array.",
  "Line 1: N. Line 2: N integers.", "One integer: the number of inversions (can exceed 32 bits).",
  "1 <= N <= 10^5, -10^9 <= a[i] <= 10^9. An O(N^2) solution is too slow.",
  ["5\n2 4 1 3 5\n", "3\n1 2 3\n"],
  lambda r: ["1\n5\n", "5\n5 4 3 2 1\n", "4\n2 2 2 2\n", arr_case(rarr(r, 1000, -10**9, 10**9)), arr_case(rarr(r, 100000, -10**9, 10**9)), arr_case(list(range(100000, 0, -1)))],
  "import sys\nsys.setrecursionlimit(10000)\ninput();a=list(map(int,input().split()))\ndef ms(a):\n    if len(a)<2: return a,0\n    m=len(a)//2;l,x=ms(a[:m]);rr,y=ms(a[m:]);o=[];i=j=0;c=x+y\n    while i<len(l) and j<len(rr):\n        if l[i]<=rr[j]: o.append(l[i]);i+=1\n        else: o.append(rr[j]);j+=1;c+=len(l)-i\n    o+=l[i:];o+=rr[j:]\n    return o,c\nprint(ms(a)[1])")

P('hard', 'Arrays', 'Largest Rectangle in Histogram',
  "A histogram has N bars of width 1 with the given heights. Find the area of the largest rectangle that fits inside the histogram.",
  "Line 1: N. Line 2: N heights.", "One integer: the largest area.",
  "1 <= N <= 10^5, 0 <= height <= 10^6",
  ["6\n2 1 5 6 2 3\n", "3\n0 0 0\n"],
  lambda r: ["1\n7\n", "5\n1 1 1 1 1\n", "5\n5 4 3 2 1\n", arr_case(rarr(r, 1000, 0, 100)), arr_case(rarr(r, 100000, 0, 10**6)), arr_case([10**6] * 100000)],
  "input();h=list(map(int,input().split()))+[0];st=[-1];best=0\nfor i,x in enumerate(h):\n    while st[-1]!=-1 and h[st[-1]]>=x:\n        H=h[st.pop()];best=max(best,H*(i-st[-1]-1))\n    st.append(i)\nprint(best)")

P('hard', 'Arrays', 'Sliding Window Maximum',
  "For every window of K consecutive elements of the array, find the largest element in the window. Print the maximum of each window from left to right.",
  "Line 1: N and K. Line 2: N integers.", "N-K+1 integers separated by spaces.",
  "1 <= K <= N <= 10^5, -10^9 <= a[i] <= 10^9",
  ["8 3\n1 3 -1 -3 5 3 6 7\n"],
  lambda r: ["1 1\n5\n", "5 5\n1 9 3 4 2\n", "5 1\n4 3 2 1 0\n", (lambda a: f"{len(a)} 7\n{A(a)}\n")(rarr(r, 100, -50, 50)),
             (lambda a: f"{len(a)} 500\n{A(a)}\n")(rarr(r, 100000, -10**9, 10**9)), (lambda a: f"{len(a)} 50000\n{A(a)}\n")(list(range(100000)))],
  "from collections import deque\nn,k=map(int,input().split());a=list(map(int,input().split()));d=deque();o=[]\nfor i,x in enumerate(a):\n    while d and a[d[-1]]<=x: d.pop()\n    d.append(i)\n    if d[0]<=i-k: d.popleft()\n    if i>=k-1: o.append(a[d[0]])\nprint(*o)")

P('hard', 'Arrays', 'Trapping Rain Water',
  "Bars of width 1 and the given heights stand side by side. After it rains, water is trapped between the bars. Compute the total amount of water (in unit squares) that stays trapped.",
  "Line 1: N. Line 2: N heights.", "One integer: the trapped water.",
  "1 <= N <= 10^5, 0 <= height <= 10^5",
  ["12\n0 1 0 2 1 0 1 3 2 1 2 1\n", "3\n3 0 3\n"],
  lambda r: ["1\n5\n", "2\n1 2\n", "5\n5 4 3 2 1\n", arr_case(rarr(r, 1000, 0, 50)), arr_case(rarr(r, 100000, 0, 10**5)), arr_case([10**5] + [0] * 99998 + [10**5])],
  "input();h=list(map(int,input().split()));l=0;r=len(h)-1;lm=rm=w=0\nwhile l<r:\n    if h[l]<h[r]:\n        lm=max(lm,h[l]);w+=lm-h[l];l+=1\n    else:\n        rm=max(rm,h[r]);w+=rm-h[r];r-=1\nprint(w)")

# ---------------------------------------------------------------- strings / backtracking
def window_case(r, n, tn, alpha):
    s = word(r, n, alpha); t = ''.join(r.sample(s, tn)) if tn <= n else s
    return f"{s}\n{t}\n"

P('hard', 'Strings', 'Minimum Window Substring',
  "Find the length of the shortest substring of S that contains every character of T (including repeated characters, so if T has two a's the window needs at least two a's). Print -1 if no such substring exists.",
  "Two lines: the string S and the string T (lowercase letters).", "One integer: the length of the shortest window, or -1.",
  "1 <= |T| <= |S| <= 10^5",
  ["ADOBECODEBANC\nABC\n".lower(), "a\naa\n"],
  lambda r: ["a\na\n", "ab\nb\n", "abc\nd\n", window_case(r, 40, 5, 'abc'), window_case(r, 5000, 30, 'abcdef'), window_case(r, 100000, 500, 'abcdefghijklmnopqrstuvwxyz'), "aaabbb\nab\n"],
  "from collections import Counter\ns=input().strip();t=input().strip();need=Counter(t);miss=len(t);best=-1;l=0\nfor r_,c in enumerate(s):\n    if need[c]>0: miss-=1\n    need[c]-=1\n    if miss==0:\n        while need[s[l]]<0: need[s[l]]+=1;l+=1\n        if best<0 or r_-l+1<best: best=r_-l+1\n        need[s[l]]+=1;miss+=1;l+=1\nprint(best)")

P('hard', 'Strings', 'Longest Palindromic Substring',
  "Find the length of the longest substring of the given string that is a palindrome.",
  "One line: a string of lowercase letters.", "One integer: the length of the longest palindromic substring.",
  "1 <= length <= 2000",
  ["babad\n", "abcd\n"],
  lambda r: ["a\n", "aa\n", "abacdfgdcaba\n", "a" * 2000 + "\n", word(r, 2000, 'ab') + "\n", word(r, 1500) + "\n", "abcbaXabcba\n"],
  "s=input().strip();n=len(s);best=1\nfor c in range(n):\n    for l,r_ in((c,c),(c,c+1)):\n        while l>=0 and r_<n and s[l]==s[r_]: l-=1;r_+=1\n        best=max(best,r_-l-1)\nprint(best)")

def wb_case(r, n, k, alpha, yes):
    words = list({word(r, r.randint(1, 8), alpha) for _ in range(k)})
    if yes:
        s = ''
        while len(s) < n: s += r.choice(words)
    else:
        s = word(r, n, alpha)
    return f"{s}\n{len(words)}\n" + "\n".join(words) + "\n"

P('hard', 'Dynamic programming', 'Word Break',
  "Given a string S and a dictionary of words, decide whether S can be written as a concatenation of dictionary words. Each word may be used any number of times.",
  "Line 1: S. Line 2: K. Then K lines, one dictionary word each.", "YES or NO.",
  "1 <= |S| <= 2000, 1 <= K <= 500, 1 <= word length <= 20 (lowercase letters)",
  ["leetcode\n2\nleet\ncode\n", "catsandog\n5\ncats\ndog\nsand\nand\ncat\n"],
  lambda r: ["a\n1\nb\n", "aaaa\n2\naa\naaa\n", "aaaaaaa\n2\naaaa\naaa\n", wb_case(r, 60, 6, 'ab', True), wb_case(r, 2000, 400, 'abc', True), wb_case(r, 2000, 400, 'abc', False),
             "a" * 1999 + "b\n2\na\naa\n".replace("2\n", "2\n")],
  "s=input().strip();k=int(input());W={input().strip() for _ in range(k)};n=len(s);L=max(map(len,W));dp=[True]+[False]*n\nfor i in range(1,n+1):\n    for l in range(1,min(L,i)+1):\n        if dp[i-l] and s[i-l:i] in W: dp[i]=True;break\nprint('YES' if dp[n] else 'NO')")

P('hard', 'Backtracking', 'N-Queens Count',
  "Count the ways to place N queens on an N x N chessboard so that no two queens attack each other (no shared row, column or diagonal).",
  "One line with an integer N.", "One integer: the number of valid placements.",
  "1 <= N <= 10",
  ["4\n", "5\n"],
  lambda r: [f"{n}\n" for n in (1, 2, 3, 6, 7, 8, 9, 10)],
  "n=int(input())\ndef go(row,c,d1,d2):\n    if row==n: return 1\n    t=0;free=~(c|d1|d2)&((1<<n)-1)\n    while free:\n        b=free&-free;free-=b\n        t+=go(row+1,c|b,(d1|b)<<1,(d2|b)>>1)\n    return t\nprint(go(0,0,0,0))")
