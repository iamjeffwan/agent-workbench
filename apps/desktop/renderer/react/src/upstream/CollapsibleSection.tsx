/*
 * Collapsible section structure adapted from HTTP Toolkit UI at
 * 66488157be993c88152bf0b5964cfa1c63e0fbf5, AGPL-3.0-or-later.
 */
import * as React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faMinus } from '@fortawesome/free-solid-svg-icons/faMinus';
import { faPlus } from '@fortawesome/free-solid-svg-icons/faPlus';
import { styled, css } from './theme';

const CollapsibleSectionWrapper = styled.section<{ $withinGrid: boolean }>`
  ${p => p.$withinGrid && css`display: contents;`}
`;

const SummaryWrapper = styled.span<{ $withinGrid: boolean }>`
  margin-right: 10px;
  ${p => p.$withinGrid && css`display: contents;`}
`;

const SummaryAsSpacer = styled.div`
  visibility: hidden;
  margin-top: -2px;
  margin-bottom: 6px;
  display: inline-block;
  max-height: 31px;
  overflow: hidden;
`;

const CollapsibleTrigger = styled.button<{ $withinGrid: boolean; $canOpen: boolean }>`
  border: none;
  background: none;
  position: relative;
  top: -1px;
  cursor: pointer;
  user-select: none;
  outline: none;
  box-sizing: content-box;
  padding: 5px 10px;
  scale: 0.7;
  color: ${p => p.theme.containerWatermark};

  &:focus { color: ${p => p.theme.popColor}; }
  &:hover { color: ${p => p.theme.mainColor}; }

  ${p => p.$withinGrid ? css`
    margin: -3px 0 -5px -10px;
    align-self: baseline;
  ` : css`
    margin: -5px 0 -5px -10px;
    vertical-align: baseline;
  `}

  ${p => !p.$canOpen && css`visibility: hidden;`}
`;

export const CollapsibleSectionSummary = styled.header<{
  $open?: boolean;
  $withinGrid?: boolean;
  $stacked?: boolean;
}>`
  ${p => p.$stacked ? css`
    display: block;
    margin: 14px 0 0;
    padding: 9px 0 12px;
    box-sizing: border-box;
  ` : css`
    ${p.$withinGrid ? css`display: contents;` : css`display: inline-block;`}
    margin: -6px 0 0 -20px;
    padding: 9px 0 12px 20px;
    box-sizing: border-box;
  `}

  ${p => p.$open && !p.$withinGrid && !p.$stacked && css`
    z-index: 1;
    position: relative;
    background-color: ${p.theme.mainBackground};

    &:before {
      content: '';
      position: absolute;
      right: -1px;
      bottom: 0;
      height: 35px;
      width: 1px;
      background-color: rgba(0,0,0,0.1);
      box-shadow: 1px 1px 5px rgba(0,0,0,${p.theme.boxShadowAlpha});
    }

    &:after {
      content: '';
      position: absolute;
      bottom: -1px;
      left: 0;
      right: 0;
      height: 1px;
      background-color: rgba(0,0,0,0.1);
      box-shadow: 1px 1px 5px rgba(0,0,0,${p.theme.boxShadowAlpha});
    }
  `}
`;

export const CollapsibleSectionBody = styled.div<{ $withinGrid?: boolean; $stacked?: boolean }>`
  ${p => p.$withinGrid ? css`
    grid-column: 1 / -1;
  ` : p.$stacked ? css`
    margin: 0 -20px 10px;
  ` : css`
    margin-top: -37px;
    margin-bottom: 10px;
  `}

  background-color: ${p => p.theme.mainLowlightBackground};
  box-shadow:
    inset 0 12px 8px -10px rgba(0,0,0,${p => p.theme.boxShadowAlpha}),
    inset 0 -8px 8px -10px rgba(0,0,0,${p => p.theme.boxShadowAlpha});
  padding: 8px 10px 10px;
  word-break: break-word;
  line-height: 1.3;
  position: relative;
  margin-left: -20px;
  margin-right: -20px;
  padding-left: 20px;
  padding-right: 20px;
`;

export function CollapsibleSection({
  children,
  withinGrid = false,
  prefixTrigger = false,
  layout = 'overlay',
  contentName,
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
}: {
  children: React.ReactNode;
  withinGrid?: boolean;
  prefixTrigger?: boolean;
  layout?: 'overlay' | 'stacked';
  contentName: string;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?(open: boolean): void;
}) {
  const stacked = layout === 'stacked';
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen);
  const open = controlledOpen ?? internalOpen;
  const id = React.useId();
  const items = React.Children.toArray(children);
  const sectionSummary = items[0];
  const sectionBody = items[1];

  if (!React.isValidElement(sectionSummary)) return null;
  const hasBody = React.isValidElement(sectionBody);
  const prefix = withinGrid || prefixTrigger;
  const toggle = (event: React.SyntheticEvent) => {
    event.preventDefault();
    const next = !open;
    if (controlledOpen === undefined) setInternalOpen(next);
    onOpenChange?.(next);
  };
  const trigger = (
    <CollapsibleTrigger
      type="button"
      $withinGrid={withinGrid}
      $canOpen={hasBody}
      aria-hidden={!hasBody}
      aria-label={`${open ? 'Hide' : 'Show'} ${contentName}`}
      aria-expanded={open}
      aria-controls={`${id}-body`}
      onClick={toggle}
    >
      <FontAwesomeIcon icon={open ? faMinus : faPlus} />
    </CollapsibleTrigger>
  );
  const summary = React.cloneElement(sectionSummary as React.ReactElement<any>, {
    $open: open,
    $withinGrid: withinGrid,
    $stacked: stacked,
  }, prefix ? <>
    {trigger}
    <SummaryWrapper $withinGrid={withinGrid}>{sectionSummary.props.children}</SummaryWrapper>
  </> : <>
    <SummaryWrapper $withinGrid={withinGrid}>{sectionSummary.props.children}</SummaryWrapper>
    {hasBody ? trigger : null}
  </>);

  let body: React.ReactNode = null;
  if (hasBody && open) {
    const bodyElement = sectionBody as React.ReactElement<any>;
    body = React.cloneElement(bodyElement, {
      $withinGrid: withinGrid,
      $stacked: stacked,
      id: `${id}-body`,
    }, withinGrid || stacked ? bodyElement.props.children : <>
      <SummaryAsSpacer aria-hidden="true">{summary}</SummaryAsSpacer>
      {bodyElement.props.children}
    </>);
  }

  return (
    <CollapsibleSectionWrapper $withinGrid={withinGrid}>
      {summary}
      {body}
    </CollapsibleSectionWrapper>
  );
}
