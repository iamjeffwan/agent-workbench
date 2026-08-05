/* Main view structure copied from HTTP Toolkit UI, AGPL-3.0-or-later. */
import * as React from 'react';
import { styled } from './theme';
import { SplitPane } from './SplitPane';
import { EventList, mockEvents, type MockEvent } from './EventList';
import { HttpDetailsPane } from './HttpDetailsPane';

const NARROW_LAYOUT_BREAKPOINT = 1100;

const LeftPane = styled.div`
  position: relative;
  height: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
`;

const StyledViewPage = styled.div`
  height: 100vh;
  position: relative;
`;

export function ViewPage() {
  const [selected, setSelected] = React.useState<MockEvent>(mockEvents[0]);
  const [width, setWidth] = React.useState(() => window.innerWidth);

  React.useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const split = width >= NARROW_LAYOUT_BREAKPOINT ? 'vertical' : 'horizontal';
  const minSize = split === 'vertical' ? 300 : 200;

  return (
    <StyledViewPage>
      <SplitPane
        split={split}
        primary="second"
        defaultSize="50%"
        minSize={minSize}
        maxSize={-minSize}
      >
        <LeftPane aria-label="The collected events list pane">
          <EventList selectedId={selected.id} onSelected={setSelected} />
        </LeftPane>
        <HttpDetailsPane event={selected} />
      </SplitPane>
    </StyledViewPage>
  );
}
