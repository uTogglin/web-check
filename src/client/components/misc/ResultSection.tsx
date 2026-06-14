import { type ReactNode } from 'react';
import styled from '@emotion/styled';
import colors from 'client/styles/colors';

const Wrap = styled.section`
  width: 100%;
  margin-bottom: 1.75rem;
`;

const Head = styled.button<{ open: boolean }>`
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.55rem 0.4rem 0.65rem 0.4rem;
  margin-bottom: 1rem;
  background: none;
  border: none;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  cursor: pointer;
  font-family: inherit;
  text-align: left;

  .bar {
    width: 4px;
    height: 1.15rem;
    border-radius: 2px;
    background: ${colors.primary};
    flex-shrink: 0;
  }
  .title {
    font-size: 1.15rem;
    font-weight: 700;
    letter-spacing: 0.01em;
    color: ${colors.textColor};
  }
  .count {
    color: ${colors.textColorSecondary};
    font-size: 0.82rem;
    font-weight: 500;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 999px;
    padding: 0.05rem 0.5rem;
  }
  .chev {
    margin-left: auto;
    color: ${colors.primary};
    font-size: 0.95rem;
    transition: transform 0.2s ease;
    transform: rotate(${(p) => (p.open ? 90 : 0)}deg);
  }
  &:hover .title {
    color: ${colors.primary};
  }
`;

const Body = styled.div<{ open: boolean }>`
  display: ${(p) => (p.open ? 'block' : 'none')};
`;

interface Props {
  id: string;
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}

const ResultSection = ({ id, title, count, open, onToggle, children }: Props): JSX.Element => (
  <Wrap>
    <Head open={open} onClick={onToggle} aria-expanded={open} id={`section-${id}`}>
      <span className="bar" />
      <span className="title">{title}</span>
      <span className="count">{count}</span>
      <span className="chev">▶</span>
    </Head>
    <Body open={open}>{children}</Body>
  </Wrap>
);

export default ResultSection;
