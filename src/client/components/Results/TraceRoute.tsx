import styled from '@emotion/styled';
import colors from 'client/styles/colors';
import { Card } from 'client/components/Form/Card';
import { hostUrl, isIpAddress } from 'client/utils/external-links';

// A hop is linkable when it's a real IP or a dotted hostname — not a "*" timeout
const isLinkableHop = (hop: string): boolean =>
  isIpAddress(hop) || (hop.includes('.') && !hop.includes('*'));

const RouteRow = styled.div`
  text-align: center;
  width: fit-content;
  margin: 0 auto;
  .ipName {
    font-size: 1rem;
  }
`;

const RouteTimings = styled.div`
  p {
    margin: 0 auto;
  }
  .arrow {
    font-size: 2.5rem;
    color: ${colors.primary};
    margin-top: -1rem;
  }
  .times {
    font-size: 0.85rem;
    color: ${colors.textColorSecondary};
  }
  .completed {
    text-align: center;
    font-weight: bold;
  }
`;

const cardStyles = ``;

const TraceRouteCard = (props: { data: any; title: string; actionButtons: any }): JSX.Element => {
  const traceRouteResponse = props.data;
  const routes = traceRouteResponse.result;
  return (
    <Card heading={props.title} actionButtons={props.actionButtons} styles={cardStyles}>
      {routes
        .filter((x: any) => x)
        .map((route: any, index: number) => {
          const hop = Object.keys(route)[0];
          return (
          <RouteRow key={index}>
            <span className="ipName">
              {isLinkableHop(hop) ? (
                <a
                  href={hostUrl(hop)}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: colors.primary, textDecoration: 'none' }}
                >
                  {hop}
                </a>
              ) : (
                hop
              )}
            </span>
            <RouteTimings>
              {route[hop].map((time: any, packetIndex: number) => (
                <p className="times" key={`timing-${packetIndex}-${time}`}>
                  {route[hop].length > 1 && <>Packet #{packetIndex + 1}:</>}
                  Took {time} ms
                </p>
              ))}
              <p className="arrow">↓</p>
            </RouteTimings>
          </RouteRow>
          );
        })}
      <RouteTimings>
        <p className="completed">Round trip completed in {traceRouteResponse.timeTaken} ms</p>
      </RouteTimings>
    </Card>
  );
};

export default TraceRouteCard;
