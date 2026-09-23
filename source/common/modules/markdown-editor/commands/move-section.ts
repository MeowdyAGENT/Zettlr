/**
 * @ignore
 * BEGIN HEADER
 *
 * Contains:        Table of Contents Commands
 * CVM-Role:        Extension
 * Maintainer:      Hendrik Erz
 * License:         GNU GPL v3
 *
 * Description:     Commands to modify a document and its table of contents.
 *
 * END HEADER
 */

import type { StateCommand } from '@codemirror/state'
import type { ToCEntry } from '../plugins/toc-field'

/**
 * This function returns a StateCommand which can be used to
 * move a table of contents section.
 *
 * @param   {ToCEntry[]}    toc   The table of contents
 * @param   {number}        from  The start line number of the section
 * @param   {number}        to    The line number to move the section to
 *
 * @return  {StateCommand}        A StateCommand which moves the section.
 */
export function moveSection (toc: ToCEntry[], from: number, to: number): StateCommand {
  return ({ state, dispatch }) => {
    const entry = toc.find(e => e.line === from)

    if (entry === undefined) {
      return false
    }

    // The section ends at either the next higher or same-level heading
    const nextSections = toc.slice(toc.indexOf(entry) + 1)
    let entryEndPos = state.doc.length

    for (const section of nextSections) {
      if (section.level <= entry.level) {
        entryEndPos = section.pos
        break
      }
    }
    const lastLine = state.doc.lines

    const toLineNumber = to !== -1 ? to : lastLine
    const toLine = state.doc.line(toLineNumber)
    const targetPos = to !== lastLine ? toLine.from : toLine.to

    const sectionText = state.doc.slice(entry.pos, entryEndPos)
    let entryContents = sectionText.toString()

    if (toLine.number === lastLine) {
      // if we are moving to the end of the document,
      // but not a new line, we need to add two new
      // lines before entryContents
      const prevLine = state.doc.line(Math.max(1, toLine.number - 1))
      if (toLine.text.trim() !== '') {
        entryContents = '\n\n' + entryContents
      // if the last line is new, but the previous one is not,
      // we need to add one new line before entryContents
      } else if (prevLine.text.trim() !== '') {
        entryContents = '\n' + entryContents
      }
    }

    const sectionLastLine = sectionText.line(sectionText.lines)
    const sectionPrevLine = sectionText.line(Math.max(1, sectionText.lines - 1))
    // if the section we are moving does not end
    // in a new line, we need to add two new lines
    //  after entryContents
    if (sectionLastLine.text.trim() !== '') {
      entryContents = entryContents + '\n\n'
    // if the section ends in a new line, but the previous one
    // is not a new line, then we need to add one new line
    // after the entryContents
    } else if (sectionPrevLine.text.trim() !== '') {
      entryContents = entryContents + '\n'
    }

    const changes = [
      { from: entry.pos, to: entryEndPos, insert: '' },
      { from: targetPos, insert: entryContents }
    ]

    dispatch(state.update({ changes }))
    return true
  }
}

/**
 * Describes a single text replacement that sorts (sub-)sections.
 */
export interface SectionSortPlan {
  /**
   * The character offset where the sorted range begins
   */
  from: number
  /**
   * The character offset where the sorted range ends (exclusive)
   */
  to: number
  /**
   * The replacement text with the sections in sorted order
   */
  insert: string
}

/**
 * The direction in which sections can be sorted.
 */
export type SectionSortDirection = 'asc'|'desc'

/**
 * Computes the text replacement necessary to sort a set of sibling sections
 * alphabetically: either the top-level sections of the whole document
 * (parentLine is null) or the child sections of a single heading. The
 * sections are permuted as whole blocks, so the document text is rearranged
 * accordingly while every section keeps its content.
 *
 * @param   {ToCEntry[]}             toc         The table of contents
 * @param   {Function}               slice       Returns the document text within [from, to)
 * @param   {number}                 docLength   The length of the document
 * @param   {number|null}            parentLine  The line number of the parent heading, or null to sort top-level sections
 * @param   {SectionSortDirection}   direction   The sort direction
 *
 * @return  {SectionSortPlan|null}               The replacement plan, or null if there is nothing to sort
 */
export function planSectionSort (
  toc: ToCEntry[],
  slice: (from: number, to: number) => string,
  docLength: number,
  parentLine: number|null,
  direction: SectionSortDirection
): SectionSortPlan|null {
  let siblings: ToCEntry[]
  let rangeEnd: number

  if (parentLine === null) {
    // Sort the top-level sections of the whole document, i.e. the entries
    // with the smallest heading level present in the table of contents.
    if (toc.length === 0) {
      return null
    }
    const topLevel = Math.min(...toc.map(entry => entry.level))
    siblings = toc.filter(entry => entry.level === topLevel)
    rangeEnd = docLength
  } else {
    const parentIdx = toc.findIndex(entry => entry.line === parentLine)
    if (parentIdx < 0) {
      return null
    }
    const parent = toc[parentIdx]
    // The child range runs until the next heading with a level less than or
    // equal to the parent's level (or the end of the document).
    let endIdx = toc.length
    for (let i = parentIdx + 1; i < toc.length; i++) {
      if (toc[i].level <= parent.level) {
        endIdx = i
        break
      }
    }
    const childRange = toc.slice(parentIdx + 1, endIdx)
    if (childRange.length === 0) {
      return null
    }
    // Sort the direct children; deeper nested sections move along with them.
    const childLevel = Math.min(...childRange.map(entry => entry.level))
    siblings = childRange.filter(entry => entry.level === childLevel)
    rangeEnd = endIdx < toc.length ? toc[endIdx].pos : docLength
  }

  if (siblings.length < 2) {
    return null
  }

  const sorted = [...siblings].sort((a, b) => {
    const comparison = a.text.localeCompare(b.text, undefined, { sensitivity: 'base', numeric: true })
    return direction === 'asc' ? comparison : -comparison
  })

  // The sections are already in the desired order: nothing to do.
  if (sorted.every((entry, idx) => entry === siblings[idx])) {
    return null
  }

  // The sibling blocks partition the range contiguously, so permuting them
  // yields the rearranged document without touching any text.
  const blocks = siblings.map((entry, idx) => {
    const blockEnd = idx + 1 < siblings.length ? siblings[idx + 1].pos : rangeEnd
    return slice(entry.pos, blockEnd)
  })
  const blockIndex = new Map<ToCEntry, number>(siblings.map((entry, idx) => [entry, idx]))
  const insert = sorted.map(entry => blocks[blockIndex.get(entry) as number]).join('')

  return { from: siblings[0].pos, to: rangeEnd, insert }
}

/**
 * This function returns a StateCommand which can be used to sort the
 * (sub-)sections of a document alphabetically, rearranging the document
 * text accordingly.
 *
 * @param   {ToCEntry[]}            toc         The table of contents
 * @param   {number|null}           parentLine  The line number of the parent heading, or null to sort top-level sections
 * @param   {SectionSortDirection}  direction   The sort direction
 *
 * @return  {StateCommand}                      A StateCommand which sorts the sections.
 */
export function sortSections (toc: ToCEntry[], parentLine: number|null, direction: SectionSortDirection): StateCommand {
  return ({ state, dispatch }) => {
    const plan = planSectionSort(
      toc,
      (from, to) => state.doc.slice(from, to).toString(),
      state.doc.length,
      parentLine,
      direction
    )

    if (plan === null) {
      return false
    }

    dispatch(state.update({ changes: plan }))
    return true
  }
}
