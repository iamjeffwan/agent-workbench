/*
 * HTTP detail cards adapted from HTTP Toolkit UI at
 * 66488157be993c88152bf0b5964cfa1c63e0fbf5, AGPL-3.0-or-later.
 */
import * as React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronDown } from '@fortawesome/free-solid-svg-icons/faChevronDown';
import { faChevronUp } from '@fortawesome/free-solid-svg-icons/faChevronUp';
import { faExpand } from '@fortawesome/free-solid-svg-icons/faExpand';
import { faCompressArrowsAlt } from '@fortawesome/free-solid-svg-icons/faCompressArrowsAlt';
import { faDownload } from '@fortawesome/free-solid-svg-icons/faDownload';
import { faExternalLinkAlt } from '@fortawesome/free-solid-svg-icons/faExternalLinkAlt';
import { faAtom } from '@fortawesome/free-solid-svg-icons/faAtom';
import { faChrome } from '@fortawesome/free-brands-svg-icons/faChrome';
import { faNodeJs } from '@fortawesome/free-brands-svg-icons/faNodeJs';
import { mix } from 'polished';
import { styled, css } from './theme';
import type { MockEvent } from './EventList';
import {
  CollapsibleSection,
  CollapsibleSectionBody,
  CollapsibleSectionSummary,
} from './CollapsibleSection';

const CodeViewer = React.lazy(() => import('./CodeViewer').then(module => ({
  default: module.CodeViewer,
})));

type HeaderPair = readonly [string, string];

const PaneOuterContainer = styled.div`
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

const PaneScrollInnerContainer = styled.div<{ $expanded: boolean }>`
  min-height: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  padding-top: ${p => p.$expanded ? '0' : '20px'};
`;

const Card = styled.section`
  box-sizing: border-box;
  background-color: ${p => p.theme.mainBackground};
  border-radius: 4px;
  box-shadow: 0 2px 10px 0 rgba(0,0,0,${p => p.theme.boxShadowAlpha});
  position: relative;

  > header h1 { font-size: ${p => p.theme.headingSize}; font-weight: bold; }
  > header {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
  }
`;

const DetailCard = styled(Card)<{
  $collapsed: boolean;
  $direction?: 'left' | 'right';
  $expanded?: boolean;
}>`
  padding: 20px;
  margin-bottom: 20px;
  display: flex;
  flex-direction: column;
  transition: margin-bottom 0.1s;

  > header {
    text-transform: uppercase;
    text-align: right;
    color: ${p => p.theme.containerWatermark};
    &:not(:last-child) { margin-bottom: 20px; }
  }

  ${p => p.$collapsed && css`
    &:not(:last-child) { margin-bottom: -16px; }
  `}

  ${p => p.$expanded ? css`
    height: 100cqh;
    width: 100%;
    border-radius: 0;
    margin: 0;
    flex-shrink: 1;
    min-height: 0;
  ` : p.$direction === 'right' ? css`
    padding-right: 15px;
    border-right: solid 5px ${p.theme.containerBorder};
  ` : css`
    padding-left: 15px;
    border-left: solid 5px ${p.theme.containerBorder};
  `}

  &:focus-within {
    outline: none;
    border-color: ${p => p.theme.popColor};
    header h1 { color: ${p => p.theme.popColor}; }
  }
`;

const CardHeading = styled.h1`
  margin: 0;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
`;

const CollapseButton = styled.button`
  border: none;
  background: none;
  color: inherit;
  cursor: pointer;
  user-select: none;
  padding: 4px 10px;
  margin: 0 -10px 0 -3px;
  box-sizing: content-box;
  &:hover, &:focus { outline: none; color: ${p => p.theme.popColor}; }
`;

const Pill = styled.span<{ $color?: string }>`
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
  background-color: ${p => mix(0.3, p.$color ?? p.theme.pillDefaultColor, p.theme.mainBackground)};
`;

const ContentLabel = styled.h2`
  margin: 0;
  font-size: ${p => p.theme.textSize};
  font-weight: 400;
  text-transform: uppercase;
  font-family: ${p => p.theme.titleTextFamily};
  color: ${p => p.theme.containerWatermark};
  display: inline-block;
  margin-right: 5px;
`;

const ContentLabelBlock = styled(ContentLabel)`
  padding: 3px 0 0;
  margin: 0 0 5px;
  min-height: 26px;
  display: block;
  box-sizing: border-box;
`;

const ContentMonoValueInline = styled.div`
  display: inline;
  width: 100%;
  font-family: ${p => p.theme.monoFontFamily};
  word-break: break-all;
  line-height: 1.1;
`;

const HeadersGrid = styled.section`
  display: grid;
  grid-template-columns: 20px fit-content(30%) 1fr;
  gap: 5px 0;
  &:not(:last-child) { margin-bottom: 10px; }
`;

const HeaderKeyValueContainer = styled(CollapsibleSectionSummary)`
  word-break: break-word;
  font-family: ${p => p.theme.monoFontFamily};
  font-weight: 400;
  line-height: 1.1;
`;

const HeaderName = styled.span`
  margin-right: 10px;
`;

const HeaderValue = styled.span`
  min-width: 0;
`;

const HeaderDescriptionContainer = styled(CollapsibleSectionBody)`
  line-height: 1.3;
`;

const ExternalLinkIcon = styled(FontAwesomeIcon)`
  opacity: 0.5;
  margin-left: 5px;

  &:focus {
    outline: none;
    color: ${p => p.theme.popColor};
  }
`;

const DocsAnchor = styled.a`
  &[href] {
    color: ${p => p.theme.linkColor};

    &:visited {
      color: ${p => p.theme.visitedLinkColor};
    }
  }
`;

const HeaderDocsLink = styled(DocsAnchor)`
  display: block;
  margin-top: 10px;
`;

const DocumentationParagraph = styled.p`
  margin-bottom: 10px;
`;

const HeaderHeadingContainer = styled.div<{ $open?: boolean }>`
  display: flex;
  align-items: baseline;
  justify-content: flex-start;
  ${p => p.$open !== true && `margin-bottom: -10px;`}
`;

const SourceGlyph = styled(FontAwesomeIcon)`margin-left: 8px;`;

const HeaderButtons = styled.div`
  display: flex;
  margin-right: auto;
`;

const IconButton = styled.button`
  border: none;
  background: none;
  color: ${p => p.theme.mainColor};
  padding: 5px 8px;
  cursor: pointer;
  &:hover, &:focus { outline: none; color: ${p => p.theme.popColor}; }
`;

const ContentTypeSelect = styled.select`
  border: 0;
  border-radius: 4px;
  padding: 4px 7px;
  color: ${p => p.theme.mainColor};
  background: ${p => mix(0.3, p.theme.pillDefaultColor, p.theme.mainBackground)};
  font: inherit;
  font-weight: bold;
  text-transform: uppercase;
`;

const CodeLoadingPlaceholder = styled.div`
  height: 190px;
  margin: 0 -20px -20px;
  border: solid 1px ${p => p.theme.containerBorder};
  display: flex;
  align-items: center;
  justify-content: center;
  color: ${p => p.theme.containerWatermark};
  background: ${p => p.theme.highlightBackground};
`;

function getHeaderDescription(name: string) {
  const descriptions: Record<string, string> = {
    accept: 'The Accept request HTTP header indicates which content types the client is able to understand.',
    'accept-encoding': 'The Accept-Encoding request HTTP header indicates the content encoding that the client can understand.',
    'accept-language': 'The Accept-Language request HTTP header indicates the natural language and locale preferred by the client.',
    connection: 'The Connection general header controls whether or not the network connection stays open after the current transaction finishes.',
    'content-encoding': 'The Content-Encoding representation header lists any encodings applied to the response body.',
    'content-type': 'The Content-Type representation header indicates the original media type of the resource.',
    host: 'The Host request header specifies the host and port number of the server to which the request is being sent.',
    referer: 'The Referer request header identifies the address from which the resource was requested.',
    server: 'The Server response header describes the software used by the origin server.',
    'user-agent': 'The User-Agent request header identifies the application, operating system, vendor, and version making the request.',
  };
  return descriptions[name.toLowerCase()];
}

function HeaderDetails({ headers }: { headers: HeaderPair[] }) {
  return (
    <HeadersGrid>
      {headers.map(([name, value], index) => {
        const description = getHeaderDescription(name);
        return (
          <CollapsibleSection
            withinGrid
            contentName={`${name} header details`}
            key={`${name}-${index}`}
          >
            <HeaderKeyValueContainer>
              <HeaderName>{name}:</HeaderName>
              <HeaderValue>{value}</HeaderValue>
            </HeaderKeyValueContainer>
            {description ? (
              <HeaderDescriptionContainer>
                <p>{description}</p>
                <HeaderDocsLink
                  href={`https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/${encodeURIComponent(name)}`}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Find out more <ExternalLinkIcon icon={faExternalLinkAlt} />
                </HeaderDocsLink>
              </HeaderDescriptionContainer>
            ) : null}
          </CollapsibleSection>
        );
      })}
    </HeadersGrid>
  );
}

function DetailCardContainer({ title, direction, collapsed, onCollapsed, header, children, expanded = false }: {
  title: string;
  direction: 'left' | 'right';
  collapsed: boolean;
  onCollapsed(): void;
  header?: React.ReactNode;
  children: React.ReactNode;
  expanded?: boolean;
}) {
  return (
    <DetailCard
      $collapsed={collapsed}
      $direction={direction}
      $expanded={expanded}
      aria-expanded={!collapsed}
      aria-label={`${title} details`}
      tabIndex={0}
      onKeyDown={event => {
        if (event.target === event.currentTarget && event.key === 'Enter') onCollapsed();
      }}
    >
      <header>
        {header}
        <CardHeading onClick={onCollapsed}>{title}</CardHeading>
        <CollapseButton type="button" onClick={onCollapsed} aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${title}`}>
          <FontAwesomeIcon icon={collapsed ? faChevronDown : faChevronUp} />
        </CollapseButton>
      </header>
      {!collapsed ? children : null}
    </DetailCard>
  );
}

function sourceIcon(event: MockEvent) {
  if (event.source === 'Chrome') return { icon: faChrome, color: '#1da462' };
  if (event.source === 'Node') return { icon: faNodeJs, color: '#3c873a' };
  return { icon: faAtom, color: '#5b96a3' };
}

function requestHeaders(event: MockEvent): HeaderPair[] {
  return [
    ['Accept', event.host.includes('fonts.') ? 'text/css,*/*;q=0.1' : 'application/json, text/plain, */*'],
    ['Accept-Encoding', 'gzip, deflate, br, zstd'],
    ['Accept-Language', 'zh-CN,zh;q=0.9'],
    ['Connection', 'keep-alive'],
    ['Content-Type', 'application/json'],
    ['Host', event.host],
    ['Referer', 'https://amusing.httptoolkit.tech/'],
    ['sec-ch-ua', '"Google Chrome";v="149", "Chromium";v="149", "Not)A;Brand";v="24"'],
    ['sec-ch-ua-mobile', '?0'],
    ['sec-ch-ua-platform', '"Windows"'],
    ['Sec-Fetch-Dest', 'empty'],
    ['Sec-Fetch-Mode', 'cors'],
    ['Sec-Fetch-Site', 'cross-site'],
    ['User-Agent', `Mozilla/5.0 (Windows NT 10.0; Win64; x64) ${event.source}/128.0`],
  ];
}

function responseHeaders(event: MockEvent): HeaderPair[] {
  return [
    ['Access-Control-Allow-Origin', '*'],
    ['Cache-Control', 'private, max-age=60'],
    ['Connection', 'keep-alive'],
    ['Content-Encoding', 'br'],
    ['Content-Type', event.host.includes('fonts.') ? 'text/css; charset=UTF-8' : 'application/json; charset=utf-8'],
    ['Date', 'Mon, 03 Aug 2026 07:16:54 GMT'],
    ['Server', event.host.includes('github') ? 'GitHub.com' : 'example-edge'],
    ['Transfer-Encoding', 'chunked'],
    ['Vary', 'Accept-Encoding'],
  ];
}

const cssBody = `@font-face {
  font-family: 'DM Sans';
  font-style: normal;
  font-weight: 400;
  src: local('DM Sans'), url('/assets/dm-sans-latin-400-normal.woff2') format('woff2');
}

@font-face {
  font-family: 'DM Mono';
  font-style: normal;
  font-weight: 400;
  src: local('DM Mono'), url('/assets/dm-mono-latin-400-normal.woff2') format('woff2');
}

body {
  font-family: 'DM Sans', sans-serif;
  color: #1e2028;
  background: #fafafa;
}`;

function formattedJson(event: MockEvent) {
  return JSON.stringify({
    status: Number(event.status) >= 400 ? 'error' : 'ok',
    source: 'HTTP Toolkit',
    requestId: event.id,
    request: {
      method: event.method,
      url: `https://${event.host}${event.path}`,
    },
  }, null, 2);
}

function statusMessage(status: string) {
  if (status === '101') return 'Switching Protocols';
  if (status === '201') return 'Created';
  if (status === '202') return 'Accepted';
  if (status === '204') return 'No Content';
  if (status === '304') return 'Not Modified';
  if (status === '400') return 'Bad Request';
  if (status === '404') return 'Not Found';
  if (status === '500') return 'Internal Server Error';
  return 'OK';
}

function RequestCard({ event, headersOpen, onHeadersOpen }: {
  event: MockEvent;
  headersOpen: boolean;
  onHeadersOpen(open: boolean): void;
}) {
  const [collapsed, setCollapsed] = React.useState(false);
  const source = sourceIcon(event);
  return (
    <DetailCardContainer
      title="Request"
      direction="right"
      collapsed={collapsed}
      onCollapsed={() => setCollapsed(!collapsed)}
      header={<>
        <SourceGlyph icon={source.icon} color={source.color} title={event.source} />
        <Pill>HTTP/1.1</Pill>
        <Pill $color={event.color}>{event.method} {event.host.replace(/\./g, '\u2008.\u2008')}</Pill>
      </>}
    >
      <div>
        <CollapsibleSection contentName={`${event.method} method documentation`}>
          <CollapsibleSectionSummary>
            <ContentLabel>Method:</ContentLabel> {event.method}
          </CollapsibleSectionSummary>
          <CollapsibleSectionBody>
            <DocumentationParagraph>The {event.method} method requests the selected resource using the headers shown below.</DocumentationParagraph>
            <p><DocsAnchor href="https://developer.mozilla.org/en-US/docs/Web/HTTP/Methods" target="_blank" rel="noreferrer noopener">
              Find out more <ExternalLinkIcon icon={faExternalLinkAlt} />
            </DocsAnchor></p>
          </CollapsibleSectionBody>
        </CollapsibleSection>
        <ContentLabelBlock>URL</ContentLabelBlock>
        <CollapsibleSection
          contentName="URL components"
          prefixTrigger
        >
          <CollapsibleSectionSummary>
            <ContentMonoValueInline>https://{event.host}{event.path}</ContentMonoValueInline>
          </CollapsibleSectionSummary>
          <CollapsibleSectionBody>
            <HeaderDetails headers={[
              ['Protocol', 'https:'],
              ['Hostname', event.host],
              ['Path', event.path],
            ]} />
          </CollapsibleSectionBody>
        </CollapsibleSection>
        <CollapsibleSection
          contentName="Headers"
          open={headersOpen}
          onOpenChange={onHeadersOpen}
        >
          <HeaderHeadingContainer>
            <ContentLabelBlock>Headers</ContentLabelBlock>
          </HeaderHeadingContainer>
          <HeaderDetails headers={requestHeaders(event)} />
        </CollapsibleSection>
      </div>
    </DetailCardContainer>
  );
}

function ResponseCard({ event, headersOpen, onHeadersOpen }: {
  event: MockEvent;
  headersOpen: boolean;
  onHeadersOpen(open: boolean): void;
}) {
  const [collapsed, setCollapsed] = React.useState(false);
  const message = statusMessage(event.status);
  return (
    <DetailCardContainer
      title="Response"
      direction="left"
      collapsed={collapsed}
      onCollapsed={() => setCollapsed(!collapsed)}
      header={<Pill $color={event.color}>{event.status}</Pill>}
    >
      <div>
        <CollapsibleSection contentName="status details">
          <CollapsibleSectionSummary>
            <ContentLabel>Status:</ContentLabel> {event.status} {message}
          </CollapsibleSectionSummary>
          <CollapsibleSectionBody>
            <DocumentationParagraph>The HTTP {event.status} {message} response describes the result returned by the server.</DocumentationParagraph>
            <p><DocsAnchor href={`https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/${event.status}`} target="_blank" rel="noreferrer noopener">
              Find out more <ExternalLinkIcon icon={faExternalLinkAlt} />
            </DocsAnchor></p>
          </CollapsibleSectionBody>
        </CollapsibleSection>
        <CollapsibleSection
          contentName="Headers"
          open={headersOpen}
          onOpenChange={onHeadersOpen}
        >
          <HeaderHeadingContainer>
            <ContentLabelBlock>Headers</ContentLabelBlock>
          </HeaderHeadingContainer>
          <HeaderDetails headers={responseHeaders(event)} />
        </CollapsibleSection>
      </div>
    </DetailCardContainer>
  );
}

function ResponseBodyCard({ event, expanded, onExpanded }: {
  event: MockEvent;
  expanded: boolean;
  onExpanded(): void;
}) {
  const [collapsed, setCollapsed] = React.useState(false);
  const defaultType = event.host.includes('fonts.') ? 'css' : 'json';
  const [contentType, setContentType] = React.useState<'css' | 'json'>(defaultType);
  const value = contentType === 'css' ? cssBody : formattedJson(event);
  const size = new Blob([value]).size;

  return (
    <DetailCardContainer
      title="Response Body"
      direction="left"
      collapsed={collapsed}
      onCollapsed={() => setCollapsed(!collapsed)}
      expanded={expanded}
      header={<>
        <HeaderButtons>
          <IconButton type="button" onClick={onExpanded} title={expanded ? 'Shrink body viewer' : 'Expand body viewer'}>
            <FontAwesomeIcon icon={expanded ? faCompressArrowsAlt : faExpand} />
          </IconButton>
          <IconButton type="button" title="Save this body as a file">
            <FontAwesomeIcon icon={faDownload} />
          </IconButton>
        </HeaderButtons>
        <Pill>{size < 1024 ? `${size} B` : `${(size / 1024).toFixed(1)} kB`}</Pill>
        <ContentTypeSelect value={contentType} onChange={e => setContentType(e.target.value as 'css' | 'json')} aria-label="Response body format">
          <option value="json">JSON</option>
          <option value="css">CSS</option>
        </ContentTypeSelect>
      </>}
    >
      <React.Suspense fallback={<CodeLoadingPlaceholder>Loading editor…</CodeLoadingPlaceholder>}>
        <CodeViewer value={value} language={contentType} expanded={expanded} />
      </React.Suspense>
    </DetailCardContainer>
  );
}

export function HttpDetailsPane({ event }: { event: MockEvent }) {
  const [expandedBody, setExpandedBody] = React.useState(false);
  const [requestHeadersOpen, setRequestHeadersOpen] = React.useState(false);
  const [responseHeadersOpen, setResponseHeadersOpen] = React.useState(false);

  React.useEffect(() => setExpandedBody(false), [event.id]);

  return (
    <PaneOuterContainer aria-label="The selected event details pane">
      <PaneScrollOuterContainer>
        <PaneScrollInnerContainer $expanded={expandedBody}>
          {expandedBody ? null : (
            <RequestCard
              key={`request-${event.id}`}
              event={event}
              headersOpen={requestHeadersOpen}
              onHeadersOpen={setRequestHeadersOpen}
            />
          )}
          {expandedBody ? null : (
            <ResponseCard
              key={`response-${event.id}`}
              event={event}
              headersOpen={responseHeadersOpen}
              onHeadersOpen={setResponseHeadersOpen}
            />
          )}
          <ResponseBodyCard
            key={`body-${event.id}`}
            event={event}
            expanded={expandedBody}
            onExpanded={() => setExpandedBody(!expandedBody)}
          />
        </PaneScrollInnerContainer>
      </PaneScrollOuterContainer>
    </PaneOuterContainer>
  );
}
