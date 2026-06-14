import { Card } from 'client/components/Form/Card';
import Row from 'client/components/Form/Row';
import Heading from 'client/components/Form/Heading';
import colors from 'client/styles/colors';

const STATUS_ICON: Record<string, string> = {
  pass: '✅',
  warn: '⚠️',
  fail: '❌',
};

const gradeColor = (grade: string): string => {
  if (['A', 'B'].includes(grade)) return colors.success;
  if (['C', 'D'].includes(grade)) return colors.warning;
  return colors.danger;
};

const Mechanism = (props: { label: string; data: any }) => {
  const { label, data } = props;
  if (!data) return null;
  return (
    <>
      <Row
        lbl={`${STATUS_ICON[data.status] || ''} ${label}`}
        val={data.present ? 'Configured' : 'Missing'}
      />
      {data.summary && (
        <p style={{ margin: '0 0 0.5rem', color: colors.textColorSecondary, fontSize: '0.85rem' }}>
          {data.summary}
        </p>
      )}
    </>
  );
};

const EmailSecurityCard = (props: {
  data: any;
  title: string;
  actionButtons: any;
}): JSX.Element => {
  const d = props.data;
  return (
    <Card heading={props.title} actionButtons={props.actionButtons}>
      {d?.grade && (
        <Heading as="h2" align="center" color={gradeColor(d.grade)}>
          {d.grade}
          <span style={{ fontSize: '1rem', color: colors.textColorSecondary }}>
            {' '}
            ({d.scorePct}/100)
          </span>
        </Heading>
      )}
      <Mechanism label="SPF" data={d?.spf} />
      <Mechanism label="DMARC" data={d?.dmarc} />
      <Mechanism label="DKIM" data={d?.dkim} />
    </Card>
  );
};

export default EmailSecurityCard;
