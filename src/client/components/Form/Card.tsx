import styled from '@emotion/styled';

import { type ReactNode } from 'react';
import ErrorBoundary from 'client/components/misc/ErrorBoundary';
import Heading from 'client/components/Form/Heading';
import colors from 'client/styles/colors';

export const StyledCard = styled.section<{ styles?: string }>`
  background: #1c1d1f;
  color: ${colors.textColor};
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 12px;
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.25),
    0 8px 24px rgba(0, 0, 0, 0.18);
  padding: 1.1rem 1.15rem;
  position: relative;
  max-height: 54rem;
  overflow: auto;
  transition:
    transform 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease;

  /* Clean header: lime title, hairline divider, room for the action buttons */
  .inner-heading {
    font-size: 1.05rem;
    font-weight: 600;
    letter-spacing: 0.01em;
    color: ${colors.primary};
    text-shadow: none;
    margin: 0 0 0.85rem 0;
    padding: 0 3rem 0.65rem 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  }

  /* Subtle, modern scrollbar so tall cards stay clean */
  &::-webkit-scrollbar {
    width: 8px;
  }
  &::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.1);
    border-radius: 8px;
  }
  &::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.18);
  }

  /* Interactive lift only for result cards (not Nav/Loader/etc. that reuse the base) */
  &.result-card:hover {
    transform: translateY(-3px);
    border-color: ${colors.primary}55;
    box-shadow:
      0 2px 4px rgba(0, 0, 0, 0.3),
      0 14px 34px rgba(0, 0, 0, 0.28),
      0 0 0 1px ${colors.primary}1f;
  }

  ${(props) => props.styles}
`;

interface CardProps {
  children: ReactNode;
  heading?: string;
  styles?: string;
  actionButtons?: ReactNode | undefined;
}

export const Card = (props: CardProps): JSX.Element => {
  const { children, heading, styles, actionButtons } = props;
  return (
    <ErrorBoundary title={heading}>
      <StyledCard className="result-card" styles={styles}>
        {actionButtons && actionButtons}
        {heading && (
          <Heading className="inner-heading" as="h3" align="left" color={colors.primary}>
            {heading}
          </Heading>
        )}
        {children}
      </StyledCard>
    </ErrorBoundary>
  );
};

export default StyledCard;
