/**
 * @ignore
 * BEGIN HEADER
 *
 * Contains:        Section sorting test
 * CVM-Role:        TESTING
 * Maintainer:      MeowdyAGENT
 * License:         GNU GPL v3
 *
 * Description:     This file tests the section sorting plan computation used
 *                  by the table of contents sorting options.
 *
 * END HEADER
 */

import assert from 'assert'
import {
  planSectionSort,
  type SectionSortDirection,
  type SectionSortPlan
} from '../source/common/modules/markdown-editor/commands/move-section'
import type { ToCEntry } from '../source/common/modules/markdown-editor/plugins/toc-field'

interface TestHeading {
  level: number
  text: string
}

/**
 * Builds a document from the given headings (each followed by a body
 * paragraph) along with a matching table of contents.
 */
function buildDoc (headings: TestHeading[], preamble = ''): { doc: string, toc: ToCEntry[] } {
  let doc = preamble
  let line = preamble === '' ? 1 : preamble.split('\n').length
  const toc: ToCEntry[] = []

  for (const heading of headings) {
    toc.push({
      line,
      pos: doc.length,
      text: heading.text,
      level: heading.level,
      renderedLevel: '',
      id: ''
    })
    doc += '#'.repeat(heading.level) + ' ' + heading.text + '\n\nBody of ' + heading.text + '.\n\n'
    line += 4
  }

  return { doc, toc }
}

function applyPlan (doc: string, plan: SectionSortPlan): string {
  return doc.slice(0, plan.from) + plan.insert + doc.slice(plan.to)
}

function sortDoc (
  doc: string,
  toc: ToCEntry[],
  parentLine: number|null,
  direction: SectionSortDirection
): string|null {
  const plan = planSectionSort(
    toc,
    (from, to) => doc.slice(from, to),
    doc.length,
    parentLine,
    direction
  )
  if (plan === null) {
    return null
  }
  return applyPlan(doc, plan)
}

describe('planSectionSort()', function () {
  it('should sort top-level sections ascending, moving content along', function () {
    const { doc, toc } = buildDoc([
      { level: 1, text: 'Charlie' },
      { level: 1, text: 'Alpha' },
      { level: 1, text: 'Bravo' }
    ])

    const result = sortDoc(doc, toc, null, 'asc')
    assert.notStrictEqual(result, null)
    const expected = buildDoc([
      { level: 1, text: 'Alpha' },
      { level: 1, text: 'Bravo' },
      { level: 1, text: 'Charlie' }
    ])
    assert.strictEqual(result, expected.doc)
  })

  it('should sort top-level sections descending', function () {
    const { doc, toc } = buildDoc([
      { level: 1, text: 'Alpha' },
      { level: 1, text: 'Bravo' },
      { level: 1, text: 'Charlie' }
    ])

    const result = sortDoc(doc, toc, null, 'desc')
    const expected = buildDoc([
      { level: 1, text: 'Charlie' },
      { level: 1, text: 'Bravo' },
      { level: 1, text: 'Alpha' }
    ])
    assert.strictEqual(result, expected.doc)
  })

  it('should sort the subsections of a single section', function () {
    const { doc, toc } = buildDoc([
      { level: 1, text: 'Parent' },
      { level: 2, text: 'c' },
      { level: 2, text: 'a' },
      { level: 2, text: 'b' },
      { level: 1, text: 'Other' }
    ])

    const parentLine = toc[0].line
    const result = sortDoc(doc, toc, parentLine, 'asc')
    const expected = buildDoc([
      { level: 1, text: 'Parent' },
      { level: 2, text: 'a' },
      { level: 2, text: 'b' },
      { level: 2, text: 'c' },
      { level: 1, text: 'Other' }
    ])
    assert.strictEqual(result, expected.doc)
  })

  it('should move nested subsections along with their parent', function () {
    const { doc, toc } = buildDoc([
      { level: 1, text: 'b' },
      { level: 2, text: 'nested' },
      { level: 1, text: 'a' }
    ])

    const result = sortDoc(doc, toc, null, 'asc')
    const expected = buildDoc([
      { level: 1, text: 'a' },
      { level: 1, text: 'b' },
      { level: 2, text: 'nested' }
    ])
    assert.strictEqual(result, expected.doc)
  })

  it('should return null when the sections are already sorted', function () {
    const { doc, toc } = buildDoc([
      { level: 1, text: 'Alpha' },
      { level: 1, text: 'Bravo' }
    ])

    assert.strictEqual(sortDoc(doc, toc, null, 'asc'), null)
  })

  it('should return null when there is nothing to sort', function () {
    const single = buildDoc([{ level: 1, text: 'Only' }])
    assert.strictEqual(sortDoc(single.doc, single.toc, null, 'asc'), null)

    const noChildren = buildDoc([
      { level: 1, text: 'Parent' },
      { level: 1, text: 'Other' }
    ])
    assert.strictEqual(sortDoc(noChildren.doc, noChildren.toc, noChildren.toc[0].line, 'asc'), null)

    assert.strictEqual(planSectionSort([], (from, to) => '', 0, null, 'asc'), null)
  })

  it('should leave text before the first heading untouched', function () {
    const preamble = '---\ntitle: Preamble\n---\n\nIntro text.\n\n'
    const { doc, toc } = buildDoc([
      { level: 1, text: 'b' },
      { level: 1, text: 'a' }
    ], preamble)

    const result = sortDoc(doc, toc, null, 'asc')
    assert.notStrictEqual(result, null)
    assert.ok((result as string).startsWith(preamble))
    const expected = buildDoc([
      { level: 1, text: 'a' },
      { level: 1, text: 'b' }
    ], preamble)
    assert.strictEqual(result, expected.doc)
  })

  it('should sort numerically aware', function () {
    const { doc, toc } = buildDoc([
      { level: 1, text: 'Section 10' },
      { level: 1, text: 'Section 2' },
      { level: 1, text: 'Section 1' }
    ])

    const result = sortDoc(doc, toc, null, 'asc')
    const expected = buildDoc([
      { level: 1, text: 'Section 1' },
      { level: 1, text: 'Section 2' },
      { level: 1, text: 'Section 10' }
    ])
    assert.strictEqual(result, expected.doc)
  })

  it('should return null for an unknown parent line', function () {
    const { doc, toc } = buildDoc([
      { level: 1, text: 'b' },
      { level: 1, text: 'a' }
    ])

    assert.strictEqual(sortDoc(doc, toc, 999, 'asc'), null)
  })
})
