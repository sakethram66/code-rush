from seedlib import P, A

P('easy', 'Basic input/output', 'Sum of Two Numbers',
  "Read two integers A and B and print their sum.",
  "One line with two integers A and B.", "A single integer: A + B.",
  "-10^9 <= A, B <= 10^9 (the sum may not fit in a 32-bit integer).",
  ["3 4\n", "-5 12\n"],
  lambda r: ["1000000000 1000000000\n", "-1000000000 -1000000000\n", "0 0\n", "999999999 1\n", "-7 7\n",
             f"{r.randint(-10**9,10**9)} {r.randint(-10**9,10**9)}\n"],
  "a,b=map(int,input().split())\nprint(a+b)")

P('easy', 'Conditions', 'Even or Odd',
  "Read an integer N and tell whether it is even or odd. Remember that negative numbers can be even or odd too.",
  "One line with an integer N.", "Print Even or Odd.",
  "-10^9 <= N <= 10^9",
  ["4\n", "7\n"],
  lambda r: ["0\n", "-3\n", "-8\n", "1000000000\n", "-999999999\n", f"{r.randint(-10**9,10**9)}\n"],
  "n=int(input())\nprint('Even' if n%2==0 else 'Odd')")

P('easy', 'Conditions', 'Largest of Three',
  "Read three integers and print the largest one.",
  "One line with three integers A, B and C.", "A single integer: the largest of the three.",
  "-10^9 <= A, B, C <= 10^9",
  ["3 9 5\n", "-1 -5 -3\n"],
  lambda r: ["7 7 7\n", "10 2 10\n", "0 -1 -2\n", "1000000000 -1000000000 0\n", "5 5 9\n",
             " ".join(str(r.randint(-10**9,10**9)) for _ in range(3)) + "\n"],
  "print(max(map(int,input().split())))")

P('easy', 'Loops', 'Sum of 1 to N',
  "Read N and print the sum 1 + 2 + ... + N.",
  "One line with an integer N.", "A single integer: the sum.",
  "1 <= N <= 10^6 (the answer can exceed 32 bits).",
  ["5\n", "100\n"],
  lambda r: ["1\n", "2\n", "1000000\n", "999999\n", "12345\n", f"{r.randint(1,10**6)}\n"],
  "n=int(input())\nprint(n*(n+1)//2)")

P('easy', 'Loops', 'Multiplication Table',
  "Read N and print its multiplication table from 1 to 10. Each line must look exactly like `N x i = product`.",
  "One line with an integer N.", "Ten lines, for i = 1 to 10: `N x i = product`.",
  "1 <= N <= 1000",
  ["7\n", "12\n"],
  lambda r: ["1\n", "1000\n", "99\n", "500\n", "250\n", f"{r.randint(1,1000)}\n"],
  "n=int(input())\nfor i in range(1,11): print(f'{n} x {i} = {n*i}')")

P('easy', 'Loops', 'Factorial',
  "Read N and print N! (N factorial). By definition 0! = 1.",
  "One line with an integer N.", "A single integer: N!",
  "0 <= N <= 20 (20! fits in a signed 64-bit integer).",
  ["5\n", "10\n"],
  lambda r: ["0\n", "1\n", "2\n", "12\n", "13\n", "20\n", "19\n"],
  "import math\nprint(math.factorial(int(input())))")

P('easy', 'Basic calculations', 'Digit Sum',
  "Read a non-negative integer N and print the sum of its decimal digits.",
  "One line with an integer N.", "A single integer: the digit sum.",
  "0 <= N <= 10^18",
  ["1234\n", "9\n"],
  lambda r: ["0\n", "1000000000000000000\n", "999999999999999999\n", "10\n", "9081726354\n", f"{r.randint(1,10**18)}\n"],
  "print(sum(map(int,input().strip())))")

P('easy', 'Basic calculations', 'Celsius to Fahrenheit',
  "Read a temperature in whole degrees Celsius and convert it to Fahrenheit using F = C * 9 / 5 + 32. Print the result with exactly 2 digits after the decimal point.",
  "One line with an integer C.", "The temperature in Fahrenheit with exactly two decimals.",
  "-100 <= C <= 1000",
  ["100\n", "-40\n"],
  lambda r: ["0\n", "37\n", "-100\n", "1000\n", "1\n", "-17\n", f"{r.randint(-100,1000)}\n"],
  "c=int(input())\nprint('%.2f'%(c*9/5+32))")

P('easy', 'Conditions', 'Leap Year',
  "A year is a leap year if it is divisible by 4, except years divisible by 100 that are not divisible by 400. Read a year and print `Leap Year` or `Not a Leap Year`.",
  "One line with an integer Y.", "Print Leap Year or Not a Leap Year.",
  "1 <= Y <= 9999",
  ["2024\n", "1900\n"],
  lambda r: ["2000\n", "2023\n", "2100\n", "4\n", "400\n", "9999\n", "1600\n"],
  "y=int(input())\nprint('Leap Year' if (y%4==0 and y%100!=0) or y%400==0 else 'Not a Leap Year')")

P('easy', 'Loops', 'FizzBuzz',
  "For every number from 1 to N print one line: `FizzBuzz` if it is divisible by both 3 and 5, `Fizz` if divisible by 3 only, `Buzz` if divisible by 5 only, otherwise the number itself.",
  "One line with an integer N.", "N lines as described.",
  "1 <= N <= 1000",
  ["5\n", "15\n"],
  lambda r: ["1\n", "3\n", "30\n", "100\n", "1000\n", "45\n"],
  "n=int(input())\nfor i in range(1,n+1): print('FizzBuzz' if i%15==0 else 'Fizz' if i%3==0 else 'Buzz' if i%5==0 else i)")
