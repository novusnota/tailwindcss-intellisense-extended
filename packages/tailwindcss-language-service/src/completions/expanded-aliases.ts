import type { CompletionList } from 'vscode-languageserver'
import type { State } from '../util/state'

type Alias = [expanded: string, canonical: string, values?: RegExp | 'color']

const alignment = /^(start|end|center|between|around|evenly|stretch|normal|baseline|auto)$/
const aliases: Alias[] = [
  ['background', 'bg'],
  ['margin', 'm'],
  ['padding', 'p'],
  ['width', 'w'],
  ['height', 'h'],
  ['min-width', 'min-w'],
  ['max-width', 'max-w'],
  ['min-height', 'min-h'],
  ['max-height', 'max-h'],
  ['z-index', 'z'],
  ['column', 'col'],
  ['flex-column', 'flex-col'],
  ['border-radius', 'rounded'],
  ['box-shadow', 'shadow'],
  ['screen-reader-only', 'sr-only'],
  ['align-items', 'items'],
  ['align-self', 'self'],
  ['align-content', 'content', alignment],
  ['justify-content', 'justify', alignment],
  ['line-height', 'leading'],
  ['letter-spacing', 'tracking'],
  ['white-space', 'whitespace'],
  ['grid-template-columns', 'grid-cols'],
  ['grid-template-rows', 'grid-rows'],
  ['transition-duration', 'duration'],
  ['transition-delay', 'delay'],
  ['transition-timing-function', 'ease'],
  ['transform-origin', 'origin'],
  ['user-select', 'select'],
  ['overscroll-behavior', 'overscroll'],
  ['font-size', 'text', /^(xs|sm|base|lg|xl|\d+xl)$/],
  ['text-align', 'text', /^(left|right|center|justify|start|end)$/],
  [
    'font-weight',
    'font',
    /^(thin|extralight|light|normal|medium|semibold|bold|extrabold|black|\d+)$/,
  ],
  ['font-family', 'font', /^(sans|serif|mono)$/],
  ['background-color', 'bg', 'color'],
  ['color', 'text', 'color'],
  ['border-color', 'border', 'color'],
  ['border-width', 'border', /^(\d+(?:\.\d+)?|px)?$/],
  ['border-style', 'border', /^(solid|dashed|dotted|double|none|hidden)$/],
]

for (let [direction, short] of [
  ['top', 't'],
  ['right', 'r'],
  ['bottom', 'b'],
  ['left', 'l'],
  ['horizontal', 'x'],
  ['vertical', 'y'],
]) {
  aliases.push([`margin-${direction}`, `m${short}`], [`padding-${direction}`, `p${short}`])
  if (short !== 'x' && short !== 'y') {
    aliases.push([`border-${direction}`, `border-${short}`])
  }
}

for (let [direction, short] of [
  ['top', 't'],
  ['right', 'r'],
  ['bottom', 'b'],
  ['left', 'l'],
  ['top-left', 'tl'],
  ['top-right', 'tr'],
  ['bottom-left', 'bl'],
  ['bottom-right', 'br'],
]) {
  aliases.push(
    [`rounded-${direction}`, `rounded-${short}`],
    [`border-radius-${direction}`, `rounded-${short}`],
    [`bg-gradient-to-${direction}`, `bg-gradient-to-${short}`],
    [`background-gradient-to-${direction}`, `bg-gradient-to-${short}`],
  )
}

aliases.sort((a, b) => b[0].length - a[0].length)

export function withExpandedAliases(
  state: State,
  completions: CompletionList,
  partial: string,
  variants: string[],
  important: boolean,
): CompletionList {
  if (important) partial = state.v4 ? partial.slice(0, -1) : partial.slice(1)
  let negative = partial.startsWith('-') ? '-' : ''
  partial = partial.slice(negative.length)

  let prefix = state.v4 ? '' : state.config?.prefix ?? ''
  if (!partial.startsWith(prefix)) return completions
  partial = partial.slice(prefix.length)

  let alias = aliases.find(([stem]) => partial === stem || partial.startsWith(`${stem}-`))
  if (!alias) return completions

  let [expanded, canonical, values] = alias
  let classes = new Map(state.classList)
  let implicitPrefix = state.v4 && variants.length === 0 ? state.designSystem.theme.prefix : ''
  let displayPrefix = implicitPrefix ? `${implicitPrefix}:` : ''
  let resolveVariants = implicitPrefix ? [implicitPrefix] : variants
  let added = []

  for (let item of completions.items) {
    let className = item.label.slice(displayPrefix.length)
    let stem = `${negative}${prefix}${canonical}`
    if (className !== stem && !className.startsWith(`${stem}-`)) continue
    let metadata = classes.get(className)
    if (!metadata) continue

    let suffix = className.slice(stem.length)
    if (values === 'color' ? !metadata.color : values && !values.test(suffix.slice(1))) continue

    let label = `${negative}${prefix}${expanded}${suffix}`
    if (!label.startsWith(`${negative}${prefix}${partial}`) || classes.has(label)) continue

    let candidate = `${important && !state.v4 ? '!' : ''}${className}${important && state.v4 ? '!' : ''}`
    if (state.blocklist?.includes([...resolveVariants, candidate].join(state.separator))) {
      continue
    }

    added.push({
      label: `${displayPrefix}${label}`,
      detail: item.label,
      kind: item.kind,
      sortText: item.sortText,
      insertText: item.label,
      textEditText: item.label,
      data: {
        ...state.completionItemData,
        className,
        variants: resolveVariants,
        ...(important ? { important } : {}),
      },
    })
  }

  return { ...completions, isIncomplete: true, items: completions.items.concat(added) }
}
