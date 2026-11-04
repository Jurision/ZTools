import { describe, expect, it } from 'vitest'
import {
  calculateQuickExpression,
  findCalculationPaperCommand
} from '../../src/shared/quickCalculation'

describe('quick arithmetic compatible with original paper decimal32 calculations', () => {
  it.each([
    ['200000*1.5', '300,000', '300000'],
    ['4/34', '0.11764705882352941176470588235294', '0.11764705882352941176470588235294'],
    ['30*1.15', '34.5', '34.5'],
    ['0.1+0.2', '0.3', '0.3'],
    ['(3+4)×2', '14', '14'],
    ['100÷8', '12.5', '12.5'],
    ['２０００００＊１．５', '300,000', '300000'],
    ['（３＋４）×２', '14', '14'],
    ['1,000.5+2', '1,002.5', '1002.5'],
    ['2^3^2', '512', '512'],
    ['-2^2', '-4', '-4'],
    ['2^-2', '0.25', '0.25'],
    ['4^0.5', '2', '2'],
    ['100+10%', '100.1', '100.1'],
    ['200*10%', '20', '20'],
    ['10%3', '1', '1'],
    ['-5%3', '1', '1'],
    ['5%0', '5', '5'],
    ['.1+.2', '0.3', '0.3'],
    ['1/10000000', '1e-7', '1e-7'],
    ['10^21', '1e+21', '1e+21']
  ])('calculates %s with exact reference format', (expression, result, copyText) => {
    expect(calculateQuickExpression(expression)).toMatchObject({ result, copyText })
  })

  it.each([
    '',
    '123',
    '-123',
    '+123',
    '(123)',
    'Chrome',
    '7-Zip',
    'Claude 4.5',
    '1+',
    '(1+2',
    '1+2)',
    '2**3',
    '1..2+3',
    '1,23+2',
    '1 2+3',
    '1/0',
    '0/0',
    '(-1)^.5',
    'Infinity+1',
    'NaN+1',
    'process.exit()',
    'alert(1)',
    '1;2',
    '2[0]',
    'Math.random()',
    '1e3+2',
    '0x10+1',
    '1=1',
    '2(3+4)',
    '"1"+2',
    '1/*x*/+2',
    '1//2',
    '2^1001',
    '10^1000*10',
    '1+'.repeat(300),
    '('.repeat(40) + '1+2' + ')'.repeat(40),
    '1+'.repeat(101) + '1',
    '-'.repeat(40) + '1+2'
  ])('rejects incomplete, non-arithmetic or unsafe input %s', (expression) => {
    expect(calculateQuickExpression(expression)).toBeNull()
  })

  it('does not alter input or use binary float display artifacts', () => {
    expect(calculateQuickExpression(' １００ ÷ ８ ')).toEqual({
      expression: '100 / 8',
      result: '12.5',
      copyText: '12.5'
    })
    expect(calculateQuickExpression('99999999999999999999+1')?.result).toBe(
      '100,000,000,000,000,000,000'
    )
  })
})

describe('calculation paper hand-off', () => {
  const command = (pluginName: string, featureCode: string, type = 'plugin') => ({
    type,
    pluginName,
    featureCode
  })
  it('prefers the local enhanced paper, falls back to the original, and ignores other features', () => {
    const next = command('calculation-paper-next', 'expression')
    const original = command('calculation-paper', 'expression')
    expect(findCalculationPaperCommand([original, next])).toBe(next)
    expect(findCalculationPaperCommand([original])).toBe(original)
    expect(
      findCalculationPaperCommand([
        command('calculation-paper-next', 'calc'),
        command('other', 'expression'),
        command('calculation-paper-next', 'expression', 'app')
      ])
    ).toBeUndefined()
  })
})
