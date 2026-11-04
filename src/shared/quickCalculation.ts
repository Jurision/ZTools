import Decimal from 'decimal.js'

const Arithmetic = Decimal.clone({ precision: 32, rounding: 4, toExpNeg: -7, toExpPos: 21 })
const MAX_LENGTH = 512
const MAX_TOKENS = 200
const MAX_DEPTH = 32
const MAX_EXPONENT = 1000

export interface QuickCalculationResult {
  expression: string
  result: string
  copyText: string
}

/**
 * Normalize explicitly supported fullwidth arithmetic without accepting arbitrary Unicode syntax.
 * @param input User search input.
 * @returns Trimmed ASCII arithmetic with multiplication/division glyphs normalized.
 */
function normalize(input: string): string {
  return input
    .replace(/[０-９＋－＊／（）％＾．，]/g, (character) =>
      String.fromCharCode(character.charCodeAt(0) - 0xfee0)
    )
    .replace(/[×÷−]/g, (character) => ({ '×': '*', '÷': '/', '−': '-' })[character]!)
    .trim()
}

/**
 * Evaluate a short arithmetic expression using a closed grammar and decimal arithmetic.
 * @param input Search text; names, single numbers and incomplete expressions are ignored.
 * @returns Normalized expression and original-paper-style result, or null for invalid/unsafe input.
 */
export function calculateQuickExpression(input: string): QuickCalculationResult | null {
  if (typeof input !== 'string' || input.length > MAX_LENGTH) return null
  const expression = normalize(input)
  if (!expression || !/^[\d\s.,+*/()%^-]+$/.test(expression)) return null
  const tokens: string[] = []
  const pattern = /\s*((?:\d{1,3}(?:,\d{3})+(?:\.\d*)?|\d+(?:\.\d*)?|\.\d+)|[+*/()%^-])/gy
  let position = 0
  while (position < expression.length) {
    pattern.lastIndex = position
    const match = pattern.exec(expression)
    if (!match || tokens.length >= MAX_TOKENS) return null
    tokens.push(match[1])
    position = pattern.lastIndex
  }
  let cursor = 0
  let depth = 0
  let operations = 0
  /**
   * Reject nonfinite and excessive intermediate results before further arithmetic.
   * @param value Decimal intermediate result.
   * @returns Bounded finite decimal.
   * @throws {Error} A result exceeds arithmetic limits.
   */
  function checked(value: Decimal): Decimal {
    if (!value.isFinite() || Math.abs(value.e) > MAX_EXPONENT) throw new Error('Arithmetic bound')
    return value
  }
  /**
   * Parse literals and parentheses; bound nested grammar calls.
   * @returns Decimal operand.
   * @throws {Error} Operand or parenthesis is missing.
   */
  function primary(): Decimal {
    if (++depth > MAX_DEPTH) throw new Error('Nesting bound')
    const token = tokens[cursor++]
    let value: Decimal
    if (token === '(') {
      value = addition()
      if (tokens[cursor++] !== ')') throw new Error('Missing parenthesis')
    } else {
      if (!token || !/^(?:\d|\.)/.test(token)) throw new Error('Missing operand')
      value = checked(new Arithmetic(token.replace(/,/g, '')))
    }
    depth--
    while (tokens[cursor] === '%' && !/^(?:\d|\.|\()/.test(tokens[cursor + 1] || '')) {
      cursor++
      operations++
      value = checked(value.div(100))
    }
    return value
  }
  /**
   * Parse right-associative powers above unary signs, as in the original math engine.
   * @returns Powered operand.
   * @throws {Error} Exponent is outside the bounded range.
   */
  function power(): Decimal {
    let value = primary()
    if (tokens[cursor] === '^') {
      cursor++
      operations++
      const exponent = unary()
      if (exponent.abs().gt(MAX_EXPONENT)) throw new Error('Exponent bound')
      value = checked(value.pow(exponent))
    }
    return value
  }
  /**
   * Parse signed operands without treating a signed number as a calculation.
   * @returns Signed decimal value.
   * @throws {Error} Unary recursion exceeds the depth bound.
   */
  function unary(): Decimal {
    if (++depth > MAX_DEPTH) throw new Error('Nesting bound')
    const sign = tokens[cursor]
    let value: Decimal
    if (sign === '+' || sign === '-') {
      cursor++
      value = unary()
      if (sign === '-') value = value.neg()
    } else value = power()
    depth--
    return value
  }
  /**
   * Parse multiply, divide and binary remainder in left-to-right order.
   * @returns Combined decimal value.
   * @throws {Error} Invalid or unbounded intermediate result.
   */
  function multiplication(): Decimal {
    let value = unary()
    while (['*', '/', '%'].includes(tokens[cursor])) {
      const operator = tokens[cursor++]
      operations++
      const right = unary()
      value = checked(
        operator === '*'
          ? value.mul(right)
          : operator === '/'
            ? value.div(right)
            : right.isZero()
              ? value
              : value.sub(right.mul(value.div(right).floor()))
      )
    }
    return value
  }
  /**
   * Parse sums and differences with the lowest arithmetic precedence.
   * @returns Combined decimal value.
   * @throws {Error} Invalid or unbounded intermediate result.
   */
  function addition(): Decimal {
    let value = multiplication()
    while (tokens[cursor] === '+' || tokens[cursor] === '-') {
      const operator = tokens[cursor++]
      operations++
      const right = multiplication()
      value = checked(operator === '+' ? value.add(right) : value.sub(right))
    }
    return value
  }
  try {
    const value = addition()
    if (cursor !== tokens.length || operations === 0) return null
    // Match original row rendering: decimal.js text with grouping on its first integer run.
    const result = value
      .toString()
      .replace(/\d+/, (digits) => digits.replace(/(\d)(?=(\d{3})+$)/g, '$1,'))
    return { expression, result, copyText: value.toString() }
  } catch {
    return null
  }
}

/**
 * Locate the calculation paper plugin's expression feature, which appends a regex payload as a new
 * row of the open paper (local enhanced build first, then the original plugin).
 * @param commands Regex-matched plugin commands known to the launcher.
 * @returns The command to launch, or undefined when no calculation paper plugin is installed.
 */
export function findCalculationPaperCommand<
  T extends { type?: string; pluginName?: string; featureCode?: string }
>(commands: readonly T[]): T | undefined {
  for (const pluginName of ['calculation-paper-next', 'calculation-paper']) {
    const found = commands.find(
      (command) =>
        command.type === 'plugin' &&
        command.pluginName === pluginName &&
        command.featureCode === 'expression'
    )
    if (found) return found
  }
  return undefined
}
