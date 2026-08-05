/* Split pane wrapper copied from HTTP Toolkit UI, AGPL-3.0-or-later. */
import * as React from 'react';
import ReactSplitPane from 'react-split-pane';
import { styled } from './theme';

const StyledSplitPane = (styled as any)(ReactSplitPane);

export const SplitPane = StyledSplitPane`
  .Resizer {
    background: #000;
    opacity: .5;
    z-index: 25;
    box-sizing: border-box;
    background-clip: padding-box;
  }

  .Resizer:hover {
    transition: all 1s ease;
    opacity: 0.9;
  }

  .Resizer.horizontal {
    height: 11px;
    margin: -5px 0;
    border-top: 5px solid rgba(255,255,255,0);
    border-bottom: 5px solid rgba(255,255,255,0);
    cursor: row-resize;
    width: 100%;
  }

  .Resizer.horizontal:hover {
    border-top: 5px solid rgba(0,0,0,0.2);
    border-bottom: 5px solid rgba(0,0,0,0.2);
  }

  .Resizer.vertical {
    width: 11px;
    margin: 0 -5px;
    border-left: 5px solid rgba(255,255,255,0);
    border-right: 5px solid rgba(255,255,255,0);
    cursor: col-resize;
  }

  .Resizer.vertical:hover {
    border-left: 5px solid rgba(0,0,0,0.2);
    border-right: 5px solid rgba(0,0,0,0.2);
  }

  .Pane { min-width: 0; }
`;
