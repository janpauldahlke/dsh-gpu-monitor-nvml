/**
 * Browser half of dsh-gpu-monitor: a rightbar tab type with a collapsible
 * GPU metrics pane.
 *
 * Two-stage registration per the ui-sidebar-right contract:
 *   1. the tab type into ctx.sidebarRightTabs (identity, guide entry)
 *   2. its body (+ live title) into the keyed sidebar.right.pane.tab seats
 *
 * A third seat: the collapsed dock chip in the composer footer
 * (`conversation.composer.dock`), which hides while the pane body is
 * mounted (shared pane-state store) and opens the tab through the
 * `sidebarRight` face on click — the same route every other "open this
 * page" action takes.
 *
 * Only the frozen platform baseline is imported at runtime; sidebar-right is
 * a type-only dependency (erased at build time).
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { GpuBody } from './GpuBody.tsx'
import { GpuDockChip } from './GpuDockChip.tsx'
import { GpuTitle } from './GpuTitle.tsx'

const TAB_ID = 'dsh-gpu-monitor'

export const inject = ['slots', 'sidebarRight', 'sidebarRightTabs']

export function apply(ctx: Context): void {
  const definition: SidebarRightTabDefinition = {
    id: TAB_ID,
    kind: 'gpu-monitor',
    title: () => 'GPU Monitor',
    guide: [{
      id: 'gpu-monitor',
      order: 200,
      title: () => 'GPU Monitor',
      description: () => 'Live NVIDIA GPU utilization, memory, power and clocks',
    }],
  }
  // Register at apply's top level (never inside an effect scope): a registry
  // registration from an effect-internal scope stalls browser boot silently.
  const disposeType = ctx.sidebarRightTabs.register(definition)
  const disposeBody = ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab', key: TAB_ID },
    GpuBody,
  ))
  const disposeTitle = ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab.title', key: TAB_ID },
    GpuTitle,
  ))
  // The collapsed dock chip, registered once next to the pane seats. The
  // seat ignores the slot's composed props; the chip reads the shared pane
  // state and hides itself while the body is mounted.
  const GpuDockSeat = () => (
    <GpuDockChip onOpen={() => ctx.sidebarRight.openTab('gpu-monitor')} />
  )
  const disposeDock = ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register(
    { name: 'conversation.composer.dock', id: 'gpu-monitor', order: -10 },
    GpuDockSeat,
  ))
  // The effect body runs immediately and must RETURN the disposer; the
  // disposer runs at fiber unload.
  ctx.effect(() => () => {
    disposeDock()
    disposeTitle()
    disposeBody()
    disposeType()
  }, 'gpu-monitor: rightbar tab type')
}
