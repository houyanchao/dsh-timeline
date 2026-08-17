/**
 * LaTeX 公式复制格式配置：移植原 global/constants.js 的 FORMULA_FORMATS
 * 与 formula-manager.js 的 applyFormulaFormat。
 * `none` 的显示文案走词典（formula.formatNone），其余格式本身国际通用。
 */

/** 单个复制格式（%s 为公式占位符）。 */
export interface FormulaFormat {
  readonly id: string
  /** 显示标签；none 由调用方用词典文案替换。 */
  readonly label: string
  readonly template: string
}

/** 全部复制格式（顺序与原版一致）。 */
export const FORMULA_FORMATS: readonly FormulaFormat[] = [
  { id: 'none', label: '无特殊附加', template: '%s' },
  { id: 'dollar', label: '$ ... $', template: '$%s$' },
  { id: 'doubleDollar', label: '$$ ... $$', template: '$$%s$$' },
  { id: 'paren', label: '\\( ... \\)', template: '\\(%s\\)' },
  { id: 'bracket', label: '\\[ ... \\]', template: '\\[%s\\]' },
  { id: 'equation', label: '\\begin{equation} ... \\end{equation}', template: '\\begin{equation}%s\\end{equation}' },
  { id: 'equationStar', label: '\\begin{equation*} ... \\end{equation*}', template: '\\begin{equation*}%s\\end{equation*}' },
  { id: 'align', label: '\\begin{align} ... \\end{align}', template: '\\begin{align}%s\\end{align}' },
  { id: 'alignStar', label: '\\begin{align*} ... \\end{align*}', template: '\\begin{align*}%s\\end{align*}' },
]

/**
 * 应用公式格式模板。
 * @param formula - 原始公式内容。
 * @param formatId - 格式 id。
 * @returns 格式化后的公式。
 */
export function applyFormulaFormat(formula: string, formatId: string): string {
  const format = FORMULA_FORMATS.find(f => f.id === formatId)
  const template = format !== undefined ? format.template : '%s'
  return template.replace('%s', formula)
}
