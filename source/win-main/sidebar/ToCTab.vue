<template>
  <div role="tabpanel">
    <!-- Table of Contents -->
    <div class="toc-header">
      <h1>{{ titleOrTocLabel }}</h1>
      <div
        v-if="canSortDocument"
        class="toc-sort-actions"
        role="group"
        v-bind:aria-label="trans('Sort sections')"
      >
        <button
          v-bind:title="trans('Sort sections ascending')"
          v-bind:aria-label="trans('Sort sections ascending')"
          v-on:click="emit('sort-sections', { parentLine: null, direction: 'asc' })"
        >
          <cds-icon shape="sort-ascending"></cds-icon>
        </button>
        <button
          v-bind:title="trans('Sort sections descending')"
          v-bind:aria-label="trans('Sort sections descending')"
          v-on:click="emit('sort-sections', { parentLine: null, direction: 'desc' })"
        >
          <cds-icon shape="sort-descending"></cds-icon>
        </button>
      </div>
    </div>
    <!-- Show the ToC entries -->
    <div
      v-for="(entry, idx) of tableOfContents"
      v-bind:key="idx"
      v-bind:data-line="entry.line"
      v-bind:class="'toc-entry-container toc-heading-' + entry.level"
      draggable="true"
      v-on:click="emit('jump-to-line', entry.line)"
      v-on:dragstart="startDragging"
      v-on:dragover="dragOver"
      v-on:drop="drop"
    >
      <div class="toc-level">
        {{ entry.renderedLevel }}
      </div>
      <div
        v-bind:class="{ 'toc-entry': true, 'toc-entry-active': tocEntryIsActive(entry.line, idx) }"
        v-bind:data-line="entry.line"
      >
        <!-- eslint-disable-next-line vue/no-v-html NOTE we can only disable this error here since the entries are run through DOMPurify. -->
        <span v-html="tocEntryHTML[idx]"></span>
      </div>
      <div
        v-if="sortableChildCount(idx) > 1"
        class="toc-sort-entry"
      >
        <button
          v-bind:title="trans('Sort subsections ascending')"
          v-bind:aria-label="trans('Sort subsections ascending')"
          v-on:click.stop="emit('sort-sections', { parentLine: entry.line, direction: 'asc' })"
        >
          <cds-icon shape="sort-ascending"></cds-icon>
        </button>
        <button
          v-bind:title="trans('Sort subsections descending')"
          v-bind:aria-label="trans('Sort subsections descending')"
          v-on:click.stop="emit('sort-sections', { parentLine: entry.line, direction: 'desc' })"
        >
          <cds-icon shape="sort-descending"></cds-icon>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { trans } from '@common/i18n-renderer'
import { ref, computed, watch, toRef, onMounted } from 'vue'
import { CITEPROC_MAIN_DB } from '@dts/common/citeproc'
import { type AnyDescriptor } from '@dts/common/fsal'
import { md2html } from '@common/modules/markdown-utils'
import { useConfigStore, useDocumentTreeStore, useWindowStateStore } from 'source/pinia'
import { sanitizeHTML } from 'source/common/util/sanitize-html'

const ipcRenderer = window.ipc
const windowStateStore = useWindowStateStore()
const documentTreeStore = useDocumentTreeStore()
const configStore = useConfigStore()

const emit = defineEmits<{
  (e: 'move-section', data: { from: number, to: number }): void
  (e: 'sort-sections', data: { parentLine: number|null, direction: 'asc'|'desc' }): void
  (e: 'jump-to-line', line: number): void
}>()

const activeFileDescriptor = ref<AnyDescriptor|null>(null)
const library = ref<string>(CITEPROC_MAIN_DB)

const tableOfContents = computed(() => windowStateStore.tableOfContents)
const tocEntryHTML = ref<string[]>([])

watch(toRef(tableOfContents), updateToCHTML)
onMounted(updateToCHTML)

/**
 * Returns either the title property for the active file or the generic ToC
 * label -- to be used within the ToC of the sidebar
 *
 * @return  {string}  The title for the ToC sidebar
 */
const titleOrTocLabel = computed(() => {
  if (
    activeFileDescriptor.value === null ||
    activeFileDescriptor.value.type !== 'file' ||
    activeFileDescriptor.value.frontmatter == null
  ) {
    return trans('Table of contents')
  }

  const frontmatter = activeFileDescriptor.value.frontmatter

  if ('title' in frontmatter && frontmatter.title.length > 0) {
    return frontmatter.title
  } else {
    return trans('Table of contents')
  }
})

const activeFile = computed(() => documentTreeStore.lastLeafActiveFile)

watch(activeFile, async (newValue) => {
  if (newValue === undefined) {
    activeFileDescriptor.value = null
  } else {
    const descriptor: AnyDescriptor|undefined = await ipcRenderer.invoke('fsal', {
      command: 'get-descriptor',
      payload: newValue.path
    })

    activeFileDescriptor.value = descriptor ?? null
  }
})

watch(activeFileDescriptor, (newValue) => {
  if (newValue === null || newValue.type !== 'file') {
    library.value = CITEPROC_MAIN_DB
  } else {
    const fm = newValue.frontmatter
    if (fm != null && 'bibliography' in fm && typeof fm.bibliography === 'string' && fm.bibliography.length > 0) {
      library.value = fm.bibliography
    }
  }
})

/**
 * Whether the cursor is within the corresponding document section
 *
 * @param   {number}  tocEntryLine          Line number of section heading
 * @param   {number}  tocEntryIdx           Index of heading in ToC
 */
function tocEntryIsActive (tocEntryLine: number, tocEntryIdx: number): boolean {
  if (tableOfContents.value === undefined || windowStateStore.activeDocumentInfo === undefined) {
    return false
  }

  const cursorLine = windowStateStore.activeDocumentInfo.cursor.line

  // Determine index of next heading in ToC list
  const nextTocEntryIdx = Math.min(tocEntryIdx + 1, tableOfContents.value.length - 1)

  // Now, determine the next heading's line number
  let nextTocEntryLine = Infinity
  if (tocEntryIdx !== nextTocEntryIdx) {
    nextTocEntryLine = tableOfContents.value[nextTocEntryIdx].line
  }

  // True, when cursor lies between current and next heading
  return (cursorLine >= tocEntryLine && cursorLine < nextTocEntryLine)
}

/**
 * Converts the ToC entries's texts to (safe) HTML.
 */
function updateToCHTML () {
  if (tableOfContents.value === undefined) {
    return
  }

  const promises: Promise<string>[] = []

  for (const entry of tableOfContents.value) {
    promises.push(
      md2html(entry.text, {
        onCitation: window.getCitationCallback(library.value),
        zknLinkFormat: configStore.config.zkn.linkFormat
      })
    )
  }

  Promise.all(promises)
    .then(values => {
      values = values.map(html => sanitizeHTML(html))
      tocEntryHTML.value = values
    })
    .catch(err => console.error(err))
}

/**
 * Whether the document contains enough top-level sections to sort
 */
const canSortDocument = computed(() => {
  const toc = tableOfContents.value
  if (toc === undefined || toc.length < 2) {
    return false
  }
  const topLevel = Math.min(...toc.map(entry => entry.level))
  return toc.filter(entry => entry.level === topLevel).length > 1
})

/**
 * Returns the number of sortable child sections of the ToC entry at the
 * given index, i.e. the number of same-level sections within it.
 *
 * @param   {number}  idx  The index of the entry within the table of contents
 *
 * @return  {number}       The number of sortable child sections
 */
function sortableChildCount (idx: number): number {
  const toc = tableOfContents.value
  if (toc === undefined) {
    return 0
  }
  const parent = toc[idx]
  let endIdx = toc.length
  for (let i = idx + 1; i < toc.length; i++) {
    if (toc[i].level <= parent.level) {
      endIdx = i
      break
    }
  }
  const childRange = toc.slice(idx + 1, endIdx)
  if (childRange.length < 2) {
    return 0
  }
  const childLevel = Math.min(...childRange.map(entry => entry.level))
  return childRange.filter(entry => entry.level === childLevel).length
}

function startDragging (event: DragEvent): void {
  if (event.currentTarget === null) {
    return
  }
  const fromLine = (event.currentTarget as HTMLElement).dataset.line
  if (fromLine !== undefined) {
    event.dataTransfer?.setData('x-zettlr/toc-drag', fromLine)
  }
}

function dragOver (event: DragEvent): void {
  const elem = document.querySelectorAll('.toc-entry-container')
  elem.forEach(e => e.classList.remove('toc-drop-effect'))
  const container = event.currentTarget as HTMLElement
  container.classList.add('toc-drop-effect')
}

function drop (event: DragEvent): void {
  if (event.currentTarget === null || event.dataTransfer === null) {
    return
  }

  const container = event.currentTarget as HTMLElement
  container.classList.remove('toc-drop-effect')

  if (container.dataset.line === undefined) {
    return
  }

  const fromLine = parseInt(event.dataTransfer.getData('x-zettlr/toc-drag'), 10)
  const toLine = parseInt(container.dataset.line, 10)
  if (fromLine === toLine) {
    return
  }

  const actualToLine = findEndOfEntry(toLine)
  if (actualToLine === undefined) {
    console.warn('Could not move section: Could not find correct target line')
    return
  }

  emit('move-section', { from: fromLine, to: actualToLine })
}

function findEndOfEntry (originalToLine: number): number|undefined {
  if (tableOfContents.value == null) {
    return
  }

  const idx = tableOfContents.value.findIndex(elem => elem.line === originalToLine)

  if (idx < 0) {
    return
  }

  if (idx === tableOfContents.value.length - 1) {
    return -1
  } else {
    return tableOfContents.value[idx + 1].line
  }
}
</script>

<style lang="less">
// Add a neat little effect to the table of content entries as you drag them
.toc-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.toc-sort-actions {
  display: flex;
  flex-shrink: 0;

  button {
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 2px 4px;
    color: inherit;
    opacity: 0.6;

    &:hover { opacity: 1; }

    cds-icon {
      width: 16px;
      height: 16px;
    }
  }
}

.toc-sort-entry {
  display: none;
  flex-shrink: 0;
  align-items: center;

  button {
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 2px;
    color: inherit;
    opacity: 0.6;

    &:hover { opacity: 1; }

    cds-icon {
      width: 14px;
      height: 14px;
    }
  }
}

.toc-entry-container:hover .toc-sort-entry {
  display: flex;
}

.toc-entry-container {
  border-bottom: 2px solid transparent;

  &.toc-heading-1 { margin-left: 0px; }
  &.toc-heading-2 { margin-left: 10px; }
  &.toc-heading-3 { margin-left: 20px; }
  &.toc-heading-4 { margin-left: 30px; }
  &.toc-heading-5 { margin-left: 40px; }
  &.toc-heading-6 { margin-left: 50px; }

  &.toc-drop-effect {
    border-bottom-color: rgb(40, 100, 255);
  }
}
</style>
