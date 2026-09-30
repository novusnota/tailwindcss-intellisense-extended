import { expect, test } from 'vitest'
import { resolve } from 'node:path'
import { withFixture } from '../common'
import { css, defineTest, js } from '../../src/testing'
import { createClient } from '../utils/client'

async function complete(client, value) {
  let document = await client.open({ lang: 'html', text: `<div class="${value}">` })
  return document.completions({ line: 0, character: 12 + value.length })
}

function aliases(result) {
  return result.items.filter((item) => item.data?.className)
}

async function checkAlias(client, value, label, canonical, inserted = canonical) {
  let result = await complete(client, value)
  let item = result.items.find((item) => item.label === label)
  expect(result.isIncomplete).toBe(true)
  expect(item).toMatchObject({
    detail: canonical,
    insertText: canonical,
    data: { className: expect.any(String), _projectKey: expect.any(String) },
    textEdit: { newText: canonical },
  })
  let { start, end } = item.textEdit.range
  expect(value.slice(0, start.character - 12) + canonical + value.slice(end.character - 12)).toBe(
    inserted,
  )
  let resolved = await client.conn.sendRequest('completionItem/resolve', item)
  expect(resolved.detail).toBe(canonical)
  expect(resolved.documentation).toMatchObject({
    kind: 'markdown',
    value: expect.stringContaining('```css'),
  })
  return resolved
}

for (let fixture of ['basic', 'v4/basic']) {
  let v4 = fixture.startsWith('v4/')
  withFixture(fixture, (c) => {
    test.each([
      ['background-green-500', 'bg-green-500'],
      ['margin-5', 'm-5'],
      ['margin-top-5', 'mt-5'],
      ['padding-horizontal-4', 'px-4'],
      ['width-5', 'w-5'],
      ['height-5', 'h-5'],
      ['min-width-0', 'min-w-0'],
      ['max-width-xl', 'max-w-xl'],
      ['min-height-0', 'min-h-0'],
      ['max-height-5', 'max-h-5'],
      ['z-index-10', 'z-10'],
      ['column-span-2', 'col-span-2'],
      ['flex-column-reverse', 'flex-col-reverse'],
      ['border-top-2', 'border-t-2'],
      ['rounded-top-left-lg', 'rounded-tl-lg'],
      ['border-radius-bottom-right-lg', 'rounded-br-lg'],
      ['border-radius-lg', 'rounded-lg'],
      ['box-shadow-lg', 'shadow-lg'],
      ['screen-reader-only', 'sr-only'],
      ['align-items-center', 'items-center'],
      ['align-self-auto', 'self-auto'],
      ['align-content-between', 'content-between'],
      ['justify-content-center', 'justify-center'],
      ['line-height-5', 'leading-5'],
      ['letter-spacing-wide', 'tracking-wide'],
      ['white-space-nowrap', 'whitespace-nowrap'],
      ['grid-template-columns-3', 'grid-cols-3'],
      ['grid-template-rows-3', 'grid-rows-3'],
      ['transition-duration-150', 'duration-150'],
      ['transition-delay-150', 'delay-150'],
      ['transition-timing-function-in', 'ease-in'],
      ['transform-origin-top', 'origin-top'],
      ['user-select-none', 'select-none'],
      ['overscroll-behavior-contain', 'overscroll-contain'],
      ['font-size-2xl', 'text-2xl'],
      ['text-align-center', 'text-center'],
      ['font-weight-bold', 'font-bold'],
      ['font-family-mono', 'font-mono'],
      ['background-color-green-500', 'bg-green-500'],
      ['color-green-500', 'text-green-500'],
      ['border-color-green-500', 'border-green-500'],
      ['border-width', 'border'],
      ['border-width-2', 'border-2'],
      ['border-style-dashed', 'border-dashed'],
    ])('%s inserts and resolves %s', async (label, canonical) => {
      await checkAlias(c.client, label, label, canonical)
    })

    test('offers the bare radius alias only if the project has rounded', async () => {
      let result = await complete(c.client, 'border-radius')
      expect(result.items.some((item) => item.label === 'rounded')).toBe(!v4)
      expect(aliases(result).some((item) => item.label === 'border-radius')).toBe(!v4)
    })

    test('preserves variants, negative values, and important markers', async () => {
      let value = v4 ? 'hover:focus:-margin-top-5!' : 'hover:focus:!-margin-top-5'
      let inserted = v4 ? 'hover:focus:-mt-5!' : 'hover:focus:!-mt-5'
      let item = await checkAlias(c.client, value, '-margin-top-5', '-mt-5', inserted)
      expect(item.data).toMatchObject({ variants: ['hover', 'focus'], important: true })
      expect(item.documentation.value).toContain('margin-top:')
      expect(item.documentation.value).toContain('!important')
    })

    test('keeps ordinary completions and narrows aliases as typing continues', async () => {
      let empty = await complete(c.client, '')
      expect(empty.isIncomplete).toBe(false)
      expect(aliases(empty)).toEqual([])
      expect(empty.items.some((item) => item.label === 'bg-green-500')).toBe(true)
      for (let value of ['backgroun', 'margin-t', 'font-siz', 'backgrounded-']) {
        let result = await complete(c.client, value)
        // "margin" is complete even when a directional stem is still being typed.
        expect(aliases(result)).toEqual([])
        expect(result.isIncomplete).toBe(value === 'margin-t')
      }
      let broad = await complete(c.client, 'background-')
      let narrow = await complete(c.client, 'background-green-5')
      expect(broad.items.filter((item) => !item.data?.className)).toEqual(
        empty.items.map((item) => ({
          ...item,
          textEdit: {
            ...item.textEdit,
            range: { start: { line: 0, character: 12 }, end: { line: 0, character: 23 } },
          },
        })),
      )
      expect(aliases(narrow).map((item) => item.label)).toEqual([
        'background-green-50',
        'background-green-500',
      ])
      expect(aliases(broad).length).toBeGreaterThan(aliases(narrow).length)
      expect((await complete(c.client, 'background-not-a-project-color-')).isIncomplete).toBe(true)
      expect(aliases(await complete(c.client, 'background-not-a-project-color-'))).toEqual([])
    })

    test('ranks matching aliases before ordinary classes and variants', async () => {
      let result = await complete(c.client, 'background-green-')
      let expanded = aliases(result)
      let firstOrdinarySort = result.items
        .filter((item) => !item.data?.className)
        .map((item) => item.sortText)
        .sort()[0]
      expect(expanded.length).toBeGreaterThan(0)
      expect(expanded.every((item) => item.sortText < firstOrdinarySort)).toBe(true)
    })

    test('disambiguates mixed families with the longest complete stem', async () => {
      for (let [stem, allowed, excluded] of [
        ['background-color-', 'background-color-green-500', 'background-color-cover'],
        ['color-', 'color-green-500', 'color-center'],
        ['border-color-', 'border-color-green-500', 'border-color-2'],
        ['border-width-', 'border-width-2', 'border-width-green-500'],
        ['border-style-', 'border-style-solid', 'border-style-2'],
        ['font-size-', 'font-size-xl', 'font-size-green-500'],
        ['text-align-', 'text-align-center', 'text-align-xl'],
        ['font-family-', 'font-family-sans', 'font-family-bold'],
        ['font-weight-', 'font-weight-bold', 'font-weight-sans'],
        ['align-content-', 'align-content-center', 'align-content-none'],
      ]) {
        let labels = aliases(await complete(c.client, stem)).map((item) => item.label)
        expect(labels).toContain(allowed)
        expect(labels).not.toContain(excluded)
        expect(labels.every((label) => label.startsWith(stem))).toBe(true)
      }
    })

    test('expands each direction only when its canonical class exists', async () => {
      for (let [direction, short] of [
        ['top', 't'],
        ['right', 'r'],
        ['bottom', 'b'],
        ['left', 'l'],
        ['horizontal', 'x'],
        ['vertical', 'y'],
      ]) {
        for (let [family, abbr] of [
          ['margin', 'm'],
          ['padding', 'p'],
        ]) {
          let result = await complete(c.client, `${family}-${direction}-`)
          expect(aliases(result).some((item) => item.detail === `${abbr}${short}-5`)).toBe(true)
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
        await checkAlias(
          c.client,
          `rounded-${direction}-lg`,
          `rounded-${direction}-lg`,
          `rounded-${short}-lg`,
        )
        let label = `background-gradient-to-${direction}`
        let result = await complete(c.client, label)
        let canonical = `bg-gradient-to-${short}`
        expect(aliases(result).some((item) => item.detail === canonical)).toBe(
          result.items.some((item) => item.label === canonical),
        )
        if (!v4) await checkAlias(c.client, label, label, canonical)
      }
    })
  })
}

for (let v4 of [false, true]) {
  defineTest({
    name: `${v4 ? 'v4' : 'v3'}: aliases respect project classes, collisions, and blocklists`,
    fs: v4
      ? {
          'app.css': css`
            @import 'tailwindcss';
            @source not inline("bg-red-500 hover:bg-green-500 focus:bg-green-500!");
            @theme {
              --color-lagoon: #123456;
              --color-blue-500: initial;
              --font-weight-450: 450;
            }
            @utility border-px {
              border-width: 1px;
            }
            @utility background-lagoon {
              display: block;
            }
          `,
        }
      : {
          'tailwind.config.js': js`
        module.exports = {
          content: [],
          blocklist: ['bg-red-500', 'hover:bg-green-500', 'focus:!bg-green-500'],
          theme: {
            colors: { lagoon: '#123456', red: { 500: '#ff0000' }, green: { 500: '#00ff00' } },
            fontWeight: { 450: '450', bold: '700' },
            borderWidth: { DEFAULT: '1px', px: '1px', '1.5': '1.5px' },
          },
          plugins: [({ addUtilities }) => addUtilities({ '.background-lagoon': { display: 'block' } })],
        }
      `,
        },
    prepare: async ({ root }) => ({ client: await createClient({ root }) }),
    handle: async ({ client }) => {
      for (let value of [
        'background-red-500',
        'background-blue-500',
        'hover:background-green-500',
        v4 ? 'focus:background-green-500!' : 'focus:!background-green-500',
      ]) {
        expect(aliases(await complete(client, value))).toEqual([])
      }
      let collision = await complete(client, 'background-lagoon')
      expect(collision.items.filter((item) => item.label === 'background-lagoon')).toHaveLength(1)
      expect(aliases(collision)).toEqual([])
      let item = await checkAlias(
        client,
        'background-color-lagoon',
        'background-color-lagoon',
        'bg-lagoon',
      )
      expect(item.documentation.value).toContain('background-color:')
      await checkAlias(
        client,
        'hover:background-red-500',
        'background-red-500',
        'bg-red-500',
        'hover:bg-red-500',
      )
      await checkAlias(client, 'font-weight-450', 'font-weight-450', 'font-450')
      await checkAlias(client, 'border-width-px', 'border-width-px', 'border-px')
    },
  })

  for (let defaults of [false, true]) {
    defineTest({
      name: `${v4 ? 'v4' : 'v3'}: prefixed aliases with itemDefaults=${defaults}`,
      fs: v4
        ? {
            'app.css': css`
              @import 'tailwindcss' prefix(tw);
            `,
          }
        : {
            'tailwind.config.js': js`module.exports = { content: [], prefix: 'tw-', separator: '__' }`,
          },
      prepare: async ({ root }) => ({
        client: await createClient({
          root,
          capabilities(caps) {
            if (defaults)
              caps.textDocument.completion.completionList = { itemDefaults: ['data', 'editRange'] }
          },
        }),
      }),
      handle: async ({ client }) => {
        let value = v4 ? 'tw:hover:-margin-top-5!' : 'hover__!-tw-margin-top-5'
        let label = v4 ? '-margin-top-5' : '-tw-margin-top-5'
        let canonical = v4 ? '-mt-5' : '-tw-mt-5'
        let result = await complete(client, value)
        let item = result.items.find((item) => item.label === label)
        expect(item).toMatchObject({
          detail: canonical,
          data: {
            className: canonical,
            variants: v4 ? ['tw', 'hover'] : ['hover'],
            important: true,
            _projectKey: expect.any(String),
          },
        })
        let range = defaults ? result.itemDefaults.editRange : item.textEdit.range
        let text = defaults ? item.textEditText : item.textEdit.newText
        expect(
          value.slice(0, range.start.character - 12) + text + value.slice(range.end.character - 12),
        ).toBe(v4 ? 'tw:hover:-mt-5!' : 'hover__!-tw-mt-5')
        let resolved = await client.conn.sendRequest('completionItem/resolve', item)
        expect(resolved.documentation.value).toContain('margin-top:')
        expect(resolved.documentation.value).toContain('!important')
        if (v4 && !defaults) {
          await checkAlias(
            client,
            'background-green-500!',
            'tw:background-green-500',
            'tw:bg-green-500',
            'tw:bg-green-500!',
          )
        }
      },
    })
  }
}

test('built server inserts and resolves aliases over stdio', async () => {
  let client = await createClient({
    root: resolve('tests/fixtures/v4/basic'),
    server: 'tailwindcss',
    mode: 'spawn',
  })
  try {
    await checkAlias(
      client,
      'hover:background-green-500',
      'background-green-500',
      'bg-green-500',
      'hover:bg-green-500',
    )
  } finally {
    await client.conn.sendRequest('shutdown')
    await client.conn.sendNotification('exit')
    client.conn.dispose()
  }
})
