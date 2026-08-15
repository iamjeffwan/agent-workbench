/* Sidebar structure and styles copied from HTTP Toolkit UI, AGPL-3.0-or-later. */
import * as React from 'react';
import {
  ChatText,
  GearSix,
  MagnifyingGlass,
  PaperPlaneTilt,
  Pencil,
  Plugs,
  Sparkle,
} from '@phosphor-icons/react';
import { styled, css } from './theme';
import logo from './logo-icon.svg';

const SidebarNav = styled.nav`
  width: 75px;
  flex-shrink: 0;
  background-color: ${p => p.theme.mainBackground};
  color: ${p => p.theme.mainColor};
  z-index: 5;
  border-right: 1px solid rgba(0,0,0,0.12);
  box-sizing: border-box;
  box-shadow: 0 0 30px rgba(0,0,0,${p => p.theme.boxShadowAlpha});
  font-size: ${p => p.theme.textSize};
  letter-spacing: -0.3px;
  display: flex;
  flex-direction: column;
`;

const sidebarItemStyles = css`
  width: 72px;
  height: 72px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  text-align: center;
  box-sizing: border-box;
  user-select: none;
  -webkit-user-drag: none;
`;

const SidebarLogo = styled.img`
  ${sidebarItemStyles}
  padding: 13px;
  margin: 3px auto 4px;
`;

const SidebarItem = styled.button<{ selected?: boolean; highlight?: boolean; $selectionSide?: 'left' | 'right' }>`
  ${sidebarItemStyles}
  width: calc(100% + 2px);
  margin: 0 -1px;
  padding: 0;
  border-width: 0 4px;
  border-style: solid;
  border-color: transparent;
  background: transparent;
  color: ${p => p.theme.mainColor};
  line-height: normal;
  cursor: pointer;
  opacity: 0.8;

  &:hover, &:focus {
    outline: none;
    color: ${p => p.theme.popColor};
    opacity: 1;
  }

  ${p => p.selected && css`
    opacity: 1;
    ${p.$selectionSide === 'left'
      ? `border-left-color: ${p.theme.popColor};`
      : `border-right-color: ${p.theme.popColor};`}
  `}

  ${p => p.highlight && css`
    color: ${p.theme.popColor};
    font-weight: bold;
  `}

  > svg {
    margin-bottom: 5px;
  }
`;

const Badge = styled.span<{ $tone: 'working' | 'ready' | 'failed' }>`
  position: absolute;
  top: 8px;
  right: 9px;
  min-width: 15px;
  height: 15px;
  padding: 0 3px;
  border-radius: 8px;
  background: ${p => p.$tone === 'failed' ? '#e1421f' : p.$tone === 'ready' ? '#168a50' : '#f1971f'};
  color: white;
  font: 700 10px/15px sans-serif;
`;

const Separator = styled.div`
  margin-top: auto;
`;

const workbenchEntries = [
  ['view', 'View', MagnifyingGlass],
  ['sources', 'Sources', Plugs],
  ['library', 'Library', Pencil],
  ['send', 'Send', PaperPlaneTilt],
] as const;
const upstreamEntries = [
  ['intercept', 'Intercept', Plugs],
  ['view', 'View', MagnifyingGlass],
  ['modify', 'Modify', Pencil],
  ['send', 'Send', PaperPlaneTilt],
] as const;

export type SidebarPage = 'view' | 'sources' | 'library' | 'settings';

export function Sidebar({
  showSelection = true,
  selectedPage = 'view',
  onNavigate,
  workbenchMode = false,
  libraryBadge,
}: {
  showSelection?: boolean;
  selectedPage?: SidebarPage;
  onNavigate?(page: SidebarPage): void;
  workbenchMode?: boolean;
  libraryBadge?: { count: number; tone: 'working' | 'ready' | 'failed' } | null;
}) {
  const entries = workbenchMode ? workbenchEntries : upstreamEntries;
  return (
    <SidebarNav aria-label={workbenchMode ? 'Agent Workbench navigation' : 'HTTP Toolkit navigation'}>
      <SidebarLogo src={logo} alt="HTTP Toolkit logo" title="HTTP Toolkit UI" />
      {entries.map(([id, name, Icon]) => (
        <SidebarItem
          key={id}
          selected={showSelection && id === selectedPage}
          $selectionSide={workbenchMode ? 'left' : 'right'}
          type="button"
          title={name}
          onClick={id === 'view' || id === 'sources' || id === 'library' ? () => onNavigate?.(id) : undefined}
          style={{ position: 'relative' }}
        >
          <Icon className="phosphor-icon" size={34} />
          {name}
          {id === 'library' && libraryBadge ? <Badge $tone={libraryBadge.tone}>{libraryBadge.count}</Badge> : null}
        </SidebarItem>
      ))}
      <Separator />
      <SidebarItem
        type="button"
        title="Settings"
        selected={showSelection && selectedPage === 'settings'}
        $selectionSide={workbenchMode ? 'left' : 'right'}
        onClick={workbenchMode ? () => onNavigate?.('settings') : undefined}
      >
        <GearSix className="phosphor-icon" size={34} />Settings
      </SidebarItem>
      <SidebarItem type="button" title="MCP"><Sparkle className="phosphor-icon" size={34} />MCP</SidebarItem>
      <SidebarItem type="button" title={workbenchMode ? 'Feedback' : 'Give feedback'}>
        <ChatText className="phosphor-icon" size={34} />{workbenchMode ? 'Feedback' : 'Give feedback'}
      </SidebarItem>
    </SidebarNav>
  );
}
