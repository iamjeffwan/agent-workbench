/*
 * Detail pane and card styles copied from HTTP Toolkit UI at
 * 66488157be993c88152bf0b5964cfa1c63e0fbf5, AGPL-3.0-or-later.
 */
import * as React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronDown } from '@fortawesome/free-solid-svg-icons/faChevronDown';
import { faChevronUp } from '@fortawesome/free-solid-svg-icons/faChevronUp';
import { faSpinner } from '@fortawesome/free-solid-svg-icons/faSpinner';
import { mix } from 'polished';
import { styled, css } from './theme';
import type { MockEvent } from './EventList';

export const PaneOuterContainer = styled.div`
  height: 100%;
  width: 100%;
  display: flex;
  flex-direction: column;
`;

const PaneScrollOuterContainer = styled.div`
  position: relative;
  overflow-y: scroll;
  flex-grow: 1;
  padding: 0 20px;
  background-color: ${p => p.theme.containerBackground};
  container-type: size;
`;

const PaneScrollInnerContainer = styled.div`
  min-height: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  padding-top: 20px;
`;

const Card = styled.section`
  box-sizing: border-box;
  background-color: ${p => p.theme.mainBackground};
  border-radius: 4px;
  box-shadow: 0 2px 10px 0 rgba(0,0,0,${p => p.theme.boxShadowAlpha});
  position: relative;

  > header h1, > h1 {
    font-size: ${p => p.theme.headingSize};
    font-weight: bold;
  }

  > header {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
  }
`;

const MediumCard = styled(Card)`
  padding: 20px;
  margin-bottom: 20px;

  > header, > h1 {
    text-transform: uppercase;
    text-align: right;
    color: ${p => p.theme.containerWatermark};
    &:not(:last-child) { margin-bottom: 20px; }
  }
`;

const CollapsibleCard = styled(MediumCard)<{ collapsed: boolean; direction?: 'left' | 'right' }>`
  display: flex;
  flex-direction: column;
  transition: margin-bottom 0.1s;

  ${p => p.collapsed && css`
    &:not(:last-child) { margin-bottom: -16px; }
  `}

  ${p => p.direction === 'right' ? css`
    padding-right: 15px;
    border-right: solid 5px ${p.theme.containerBorder};
  ` : css`
    padding-left: 15px;
    border-left: solid 5px ${p.theme.containerBorder};
  `}
`;

const CardHeading = styled.button`
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  color: inherit;
  font-size: ${p => p.theme.headingSize};
  font-weight: bold;
  text-transform: uppercase;
  cursor: pointer;
  user-select: none;

  svg {
    box-sizing: content-box;
    margin: 0 -10px 0 -3px;
    padding: 4px 10px;
  }
  &:hover { color: ${p => p.theme.popColor}; }
`;

const Pill = styled.span<{ pillColor?: string }>`
  display: inline-block;
  border-radius: 4px;
  padding: 5px 8px 3px;
  text-align: center;
  text-transform: none;
  font-weight: bold;
  word-spacing: 3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: ${p => p.theme.mainColor};
  background-color: ${p => mix(0.3, p.pillColor ?? p.theme.pillDefaultColor, p.theme.mainBackground)};
`;

const ContentLabel = styled.h2`
  margin: 0 5px 0 0;
  font-size: ${p => p.theme.textSize};
  font-weight: 400;
  text-transform: uppercase;
  font-family: ${p => p.theme.titleTextFamily};
  color: ${p => p.theme.containerWatermark};
  display: inline-block;
`;

const MonoValue = styled.div`
  padding: 3px 0 11px;
  width: 100%;
  font-family: ${p => p.theme.monoFontFamily};
  word-break: break-all;
  line-height: 1.1;
`;

const Headers = styled.dl`
  display: grid;
  grid-template-columns: minmax(100px, 30%) minmax(0, 1fr);
  gap: 7px 12px;
  margin: 12px 0 0;
  font-family: ${p => p.theme.monoFontFamily};
  font-size: ${p => p.theme.smallPrintSize};

  dt { color: ${p => p.theme.mainLowlightColor}; }
  dd { margin: 0; overflow-wrap: anywhere; }
`;

const ResponseSummary = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  text-align: center;

  strong { display: block; margin-top: 4px; font-family: ${p => p.theme.monoFontFamily}; }
`;

const LoadingCardContent = styled.div`
  min-height: 240px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: ${p => p.theme.containerWatermark};
  font-size: 90px;
`;

function DetailsCard({ title, direction, children, pill }: {
  title: string;
  direction: 'left' | 'right';
  children: React.ReactNode;
  pill?: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = React.useState(false);
  return (
    <CollapsibleCard collapsed={collapsed} direction={direction} aria-expanded={!collapsed}>
      <header>
        {pill}
        <CardHeading type="button" onClick={() => setCollapsed(!collapsed)}>
          {title} <FontAwesomeIcon icon={collapsed ? faChevronDown : faChevronUp} />
        </CardHeading>
      </header>
      {!collapsed && children}
    </CollapsibleCard>
  );
}

export function DetailsPane({ event }: { event: MockEvent }) {
  const isLoading = event.status === '101';
  const isError = Number(event.status) >= 400;
  const responseLabel = isLoading ? 'Connected' : isError ? 'Error' : 'OK';

  return (
    <PaneOuterContainer aria-label="The selected event details pane">
      <PaneScrollOuterContainer>
        <PaneScrollInnerContainer>
          <DetailsCard title="Request" direction="right" pill={<Pill pillColor={event.color}>{event.method} {event.host}</Pill>}>
            <ContentLabel>Method:</ContentLabel> {event.method}
            <ContentLabel as="div" style={{ display: 'block', marginTop: 18 }}>URL</ContentLabel>
            <MonoValue>https://{event.host}{event.path}</MonoValue>
            <ContentLabel as="div">Headers</ContentLabel>
            <Headers>
              <dt>accept</dt><dd>application/json, text/plain, */*</dd>
              <dt>user-agent</dt><dd>Mozilla/5.0 HTTP Toolkit</dd>
              <dt>accept-encoding</dt><dd>gzip, deflate, br</dd>
              <dt>connection</dt><dd>keep-alive</dd>
            </Headers>
          </DetailsCard>

          <DetailsCard title="Response" direction="left" pill={<Pill pillColor={event.color}>{event.status} {responseLabel}</Pill>}>
            {isLoading ? (
              <LoadingCardContent aria-label="Loading response body">
                <FontAwesomeIcon icon={faSpinner} spin />
              </LoadingCardContent>
            ) : (<>
              <ResponseSummary>
                <div><ContentLabel>Status</ContentLabel><strong>{event.status}</strong></div>
                <div><ContentLabel>Size</ContentLabel><strong>2.4 kB</strong></div>
                <div><ContentLabel>Time</ContentLabel><strong>184 ms</strong></div>
              </ResponseSummary>
              <ContentLabel as="div" style={{ display: 'block', marginTop: 20 }}>Headers</ContentLabel>
              <Headers>
                <dt>content-type</dt><dd>application/json; charset=utf-8</dd>
                <dt>cache-control</dt><dd>private, max-age=60</dd>
                <dt>server</dt><dd>example-edge</dd>
              </Headers>
            </>)}
          </DetailsCard>

          <DetailsCard title="Body" direction="left">
            <MonoValue>{`{\n  "status": "${isError ? 'error' : 'ok'}",\n  "source": "HTTP Toolkit",\n  "requestId": "${event.id}"\n}`}</MonoValue>
          </DetailsCard>
        </PaneScrollInnerContainer>
      </PaneScrollOuterContainer>
    </PaneOuterContainer>
  );
}
