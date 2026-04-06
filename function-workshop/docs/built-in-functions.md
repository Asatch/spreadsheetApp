# Built-In Functions Reference

## Data Types

| Type | Description | Example |
|------|-------------|---------|
| `Number` | Numeric value | `42`, `3.14`, `-100` |
| `Boolean` | True/false | Result of comparisons |
| `Text` | String | `"Hello"` |
| `Date` | Date (integer days) | Serial number |
| `DateTime` | Date+time (fractional days) | Serial number |

## Arithmetic Functions

### ADD
Adds two values.
```
=A+B
=A+5
```
- Types: `(number, number) → number`, `(date, number) → date`, `(datetime, number) → datetime`

### SUBTRACT
Subtracts second value from first.
```
=A-B
=A-10
```
- Types: `(number, number) → number`, `(date, number) → date`, `(date, date) → number`

### MULTIPLY
Multiplies two values.
```
=A*B
=A*0.05
```
- Types: `(number, number) → number`

### DIVIDE
Divides first value by second.
```
=A/B
=A/100
```
- Types: `(number, number) → number`
- Note: Division by zero returns `Infinity` with `#DOMAIN!` error

### EXPONENT
Raises first value to power of second.
```
=A^B
=A^2
```
- Types: `(number, number) → number`

### NEGATE
Negates a value (unary minus).
```
=-A
=-B1
```
- Types: `(number) → number`

### LOG
Logarithm with specified base.
```
=LOG(A,B)  // log base B of A
```
- Types: `(number, number) → number`

### LN
Natural logarithm.
```
=LN(A)
```
- Types: `(number) → number`

### LOG10
Base-10 logarithm.
```
=LOG10(A)
```
- Types: `(number) → number`

## Comparison Functions

All return `Boolean`.

### LESS
```
=A<B
```

### GREATER
```
=A>B
```

### LESSEQUAL
```
=A<=B
```

### GREATEREQUAL
```
=A>=B
```

### EQUAL
```
=A=B
```

### NOTEQUAL
```
=A<>B
```

## Logical Functions

### IF
Conditional - returns one of two values based on condition.
```
=IF(condition, value_if_true, value_if_false)
=IF(A>B, A, B)  // MAX of A and B
=IF(A<0, -A, A)  // ABS of A
```
- Types: `(boolean, T, T) → T` where T is number, boolean, date, datetime, or text
- Both branches must have same type

### AND
Logical AND of multiple booleans.
```
=AND(A, B)
=AND(A>0, B>0, C>0)
```
- Types: `(...boolean) → boolean`

### OR
Logical OR of multiple booleans.
```
=OR(A, B)
=OR(A<0, B<0)
```
- Types: `(...boolean) → boolean`

## Aggregation Functions

### SUM
Sum of values or range.
```
=SUM(A, B, C)
=SUM(A1:A5)
```
- Types: `(...number) → number`
- Note: For multiple additions, use SUM instead of chained `+`

## Special Functions

### PROCEED
Pass through a value unchanged. Used internally.
```
=PROCEED(A)
=(A)  // Parentheses also work
```

### ARRAY
Collect values into an array. Used for ranges internally.

## Formula Syntax

### Operators (Infix)
```
+   ADD
-   SUBTRACT
*   MULTIPLY
/   DIVIDE
^   EXPONENT
<   LESS
>   GREATER
<=  LESSEQUAL
>=  GREATEREQUAL
=   EQUAL
<>  NOTEQUAL
```

### Function Calls
```
=FUNCTION_NAME(arg1, arg2, ...)
=IF(A>B, 1, 0)
=SUM(A, B, C)
```

### Cell References
```
=A1        // Single cell
=B2        // Single cell
=A1:A5     // Range (for SUM, etc.)
=RATE      // Named cell
```

### Literals
```
=5         // Number
=3.14      // Decimal
=-10       // Negative (parsed as NEGATE)
="text"    // String (in some contexts)
```

### Parentheses
```
=(A+B)*C   // Grouping
=((A))     // Multiple levels OK
```

## Common Patterns

### Maximum of Two Values
```
=IF(A>B, A, B)
```

### Minimum of Two Values
```
=IF(A<B, A, B)
```

### Absolute Value
```
=IF(A<0, -A, A)
```

### Clamp to Range
```
=IF(A<MIN, MIN, IF(A>MAX, MAX, A))
```

### Percentage
```
=A/B*100
```
Note: This is `(A/B)*100` not `A/(B*100)`. Use parentheses if needed.

### Compound Interest
```
=PRINCIPAL*(ONE+RATE)^YEARS
```
Where ONE is a constant with value 1.

## Error Handling

- `#NAME!` - Unknown function or cell reference
- `#DOMAIN!` - Invalid input (e.g., division by zero, log of negative)
- `#REF!` - Invalid cell reference
- `#TYPE!` - Type mismatch

Errors propagate through calculations. If any input has an error, the output will have that error.
