import codexIcon from '@lobehub/icons-static-svg/icons/codex.svg';
import { styled } from '../upstream/theme';
import type { AgentOperation } from './types';

const BrandImage = styled.img<{ $size: number }>`
  display: block;
  width: ${p => p.$size}px;
  height: ${p => p.$size}px;
  object-fit: contain;
`;

export function AgentBrandIcon({ provider, size = 18 }: {
  provider: AgentOperation['provider'];
  size?: number;
}) {
  return (
    <BrandImage
      src={codexIcon}
      $size={size}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}
