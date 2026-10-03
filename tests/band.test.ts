import { describe, expect, test } from 'claude-code/testing'

const BAND = {
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

describe('usage band', () => {
  test('draws on the terminal as a text line with the limits', async ($, on) => {
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Text({ children: [''] }) as never)
    const ui = await $.ui.mount({ plugin: 'usage-meter-pills', surface: 'terminal', ...BAND } as never)
    expect(await ui.find({ type: 'Text', text: /5h/ })).toBeDefined()
    await ui.unmount()
  })

  test('draws on the desktop as an image with an accessible description', async ($, on) => {
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Text({ children: [''] }) as never)
    const ui = await $.ui.mount({ plugin: 'usage-meter-pills', surface: 'desktop', ...BAND } as never)
    expect(await ui.find({ type: 'Svg' })).toBeDefined()
    await ui.unmount()
  })
})

describe('settings pane', () => {
  test('lists the sections and opens with Style expanded', async $ => {
    const ui = await $.ui.mount({
      plugin: 'usage-meter-pills',
      surface: 'desktop',
      component: 'Pane',
      requestId: 'pills-settings',
      props: {},
    } as never)
    expect(await ui.find({ key: 'group:0' })).toBeDefined()
    expect(await ui.find({ key: 'group:1' })).toBeDefined()
    expect(await ui.find({ key: 'style:rings' })).toBeDefined()
    await ui.unmount()
  })
})
