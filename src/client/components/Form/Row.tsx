import type { ReactNode } from 'react';
import styled from '@emotion/styled';
import colors from 'client/styles/colors';
import Heading from 'client/components/Form/Heading';
import { isHttpUrl, isEmail } from 'client/utils/external-links';

export interface RowProps {
  lbl: string;
  val: string;
  key?: string | number;
  children?: ReactNode;
  rowList?: RowProps[];
  title?: string;
  open?: boolean;
  plaintext?: string;
  listResults?: string[];
  /** When set, render the value as a link to this URL (opens in a new tab). */
  href?: string;
  /** When set, render the label as a link to this URL (opens in a new tab). */
  lblHref?: string;
}

export const StyledRow = styled.div`
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.75rem 1rem;
  align-items: baseline;
  padding: 0.45rem 0.4rem;
  border-radius: 6px;
  transition: background 0.15s ease;
  &:not(:last-child) {
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  }
  &:hover {
    background: rgba(255, 255, 255, 0.025);
  }
  span.lbl {
    color: ${colors.textColorSecondary};
    font-weight: 500;
    flex: 1 1 auto;
    min-width: 6rem;
    overflow-wrap: anywhere;
    word-break: break-word;
    a {
      color: ${colors.primary};
      text-decoration: none;
      &:hover {
        text-decoration: underline;
      }
    }
  }
  span.val {
    color: ${colors.textColor};
    font-weight: 500;
    text-align: right;
    max-width: 18rem;
    overflow-wrap: anywhere;
    word-break: break-word;
    cursor: default;
    a {
      color: ${colors.primary};
      text-decoration: none;
      &:hover {
        text-decoration: underline;
      }
    }
  }
`;

export const Details = styled.details`
  border-radius: 6px;
  &:not(:last-child) {
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  }
  summary {
    position: relative;
    padding-left: 1.4rem;
    cursor: pointer;
    list-style: none;
    border-radius: 6px;
    &::-webkit-details-marker {
      display: none;
    }
    &:hover {
      background: rgba(255, 255, 255, 0.025);
    }
  }
  summary:before {
    content: '▸';
    position: absolute;
    left: 0.4rem;
    top: 0.5rem;
    color: ${colors.primary};
    cursor: pointer;
    transition: transform 0.2s ease;
  }
  &[open] > summary {
    border-bottom: none;
  }
  &[open] summary:before {
    transform: rotate(90deg);
  }
`;

const SubRowList = styled.ul`
  list-style: none;
  margin: 0.15rem 0 0.6rem 0.65rem;
  padding: 0.3rem 0.4rem 0.3rem 0.85rem;
  background: rgba(255, 255, 255, 0.025);
  border-left: 2px solid ${colors.primary}40;
  border-radius: 0 6px 6px 0;
`;

const PlainText = styled.pre`
  background: ${colors.background};
  width: 95%;
  white-space: pre-wrap;
  word-wrap: break-word;
  border-radius: 4px;
  padding: 0.25rem;
`;

const List = styled.ul`
  // background: ${colors.background};
  width: 95%;
  white-space: pre-wrap;
  word-wrap: break-word;
  border-radius: 4px;
  margin: 0;
  padding: 0.25rem 0.25rem 0.25rem 1rem;
  li {
    // white-space: nowrap;
    // overflow: hidden;
    text-overflow: ellipsis;
    list-style: circle;
    &:first-letter {
      text-transform: capitalize;
    }
    &::marker {
      color: ${colors.primary};
    }
  }
`;

const isValidDate = (date: any): boolean => {
  // Checks if a date is within reasonable range
  const isInRange = (date: Date): boolean => {
    return date >= new Date('1995-01-01') && date <= new Date('2030-12-31');
  };

  // Check if input is a timestamp
  if (typeof date === 'number') {
    const timestampDate = new Date(date);
    return !isNaN(timestampDate.getTime()) && isInRange(timestampDate);
  }

  // Check if input is a date string
  if (typeof date === 'string') {
    const dateStringDate = new Date(date);
    return !isNaN(dateStringDate.getTime()) && isInRange(dateStringDate);
  }

  // Check if input is a Date object
  if (date instanceof Date) {
    return !isNaN(date.getTime()) && isInRange(date);
  }

  return false;
};

const formatDate = (dateString: string): string => {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(dateString));
};
const formatValue = (value: any): string => {
  // Never hand React a raw object — serialise it so the row renders instead of
  // throwing "Objects are not valid as a React child".
  if (value !== null && typeof value === 'object') return JSON.stringify(value);
  if (isValidDate(new Date(value))) return formatDate(value);
  if (typeof value === 'boolean') return value ? '✅' : '❌';
  return value;
};

const copyToClipboard = (text: string) => {
  navigator.clipboard.writeText(text);
};

const ExternalLink = ({ href, children }: { href: string; children: ReactNode }) => (
  <a href={href} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
    {children}
  </a>
);

// Render a value: an explicit href wins; otherwise auto-link bare URLs and emails
// so any address in any card becomes clickable without per-card wiring.
const renderVal = (val: any, href?: string): ReactNode => {
  const formatted = formatValue(val);
  if (href) return <ExternalLink href={href}>{formatted}</ExternalLink>;
  if (typeof formatted === 'string') {
    if (isHttpUrl(formatted)) return <ExternalLink href={formatted}>{formatted}</ExternalLink>;
    if (isEmail(formatted)) {
      return (
        <a href={`mailto:${formatted}`} onClick={(e) => e.stopPropagation()}>
          {formatted}
        </a>
      );
    }
  }
  return formatted;
};

const snip = (text: string, length: number = 80) => {
  if (text.length < length) return text;
  return `${text.substring(0, length)}...`;
};

export const ExpandableRow = (props: RowProps) => {
  const { lbl, val, title, rowList, open } = props;
  return (
    <Details open={open}>
      <StyledRow as="summary" key={`${lbl}-${val}`}>
        <span className="lbl" title={title?.toString()}>
          {lbl}
        </span>
        <span className="val" title={val?.toString()}>
          {val.toString()}
        </span>
      </StyledRow>
      {rowList && (
        <SubRowList>
          {rowList?.map((row: RowProps, index: number) => {
            return (
              <StyledRow as="li" key={`${row.lbl}-${index}`}>
                <span className="lbl" title={row.title?.toString()}>
                  {row.lblHref ? (
                    <ExternalLink href={row.lblHref}>{row.lbl}</ExternalLink>
                  ) : (
                    row.lbl
                  )}
                </span>
                <span
                  className="val"
                  title={row.val?.toString()}
                  onClick={row.href ? undefined : () => copyToClipboard(row.val)}
                >
                  {renderVal(row.val, row.href)}
                </span>
                {row.plaintext && <PlainText>{row.plaintext}</PlainText>}
                {row.listResults && (
                  <List>
                    {row.listResults.map((listItem: string) => (
                      <li key={listItem}>{snip(listItem)}</li>
                    ))}
                  </List>
                )}
              </StyledRow>
            );
          })}
        </SubRowList>
      )}
    </Details>
  );
};

export const ListRow = (props: { list: string[]; title: string }) => {
  const { list, title } = props;
  return (
    <>
      <Heading as="h4" size="small" align="left" color={colors.primary}>
        {title}
      </Heading>
      {list.map((entry: string, index: number) => {
        return (
          <Row lbl="" val="" key={`${entry}-${title.toLocaleLowerCase()}-${index}`}>
            <span>{entry}</span>
          </Row>
        );
      })}
    </>
  );
};

const Row = (props: RowProps) => {
  const { lbl, val, title, plaintext, listResults, children, href, lblHref } = props;
  if (children) return <StyledRow key={`${lbl}-${val}`}>{children}</StyledRow>;
  return (
    <StyledRow key={`${lbl}-${val}`}>
      {lbl && (
        <span className="lbl" title={title?.toString()}>
          {lblHref ? <ExternalLink href={lblHref}>{lbl}</ExternalLink> : lbl}
        </span>
      )}
      <span
        className="val"
        title={val?.toString()}
        onClick={href ? undefined : () => copyToClipboard(val)}
      >
        {renderVal(val, href)}
      </span>
      {plaintext && <PlainText>{plaintext}</PlainText>}
      {listResults && (
        <List>
          {listResults.map((listItem: string, listIndex: number) => (
            <li key={listIndex} title={listItem}>
              {snip(listItem)}
            </li>
          ))}
        </List>
      )}
    </StyledRow>
  );
};

export default Row;
