import styled from '@emotion/styled';
import Button from 'client/components/Form/Button';
import colors from 'client/styles/colors';

const ActionButtonContainer = styled.div`
  position: absolute;
  top: 0.85rem;
  right: 0.85rem;
  opacity: 0.55;
  display: flex;
  gap: 0.25rem;
  align-items: center;
  transition: opacity 0.18s ease;
  z-index: 1;
  &:hover {
    opacity: 1;
  }
`;

interface Action {
  label: string;
  icon: string;
  onClick: () => void;
}

const actionButtonStyles = `
  padding: 0;
  font-size: 1rem;
  line-height: 1;
  text-align: center;
  width: 1.75rem;
  height: 1.75rem;
  border-radius: 8px;
  color: ${colors.textColorSecondary};
  background: none;
  box-shadow: none;
  transition: all 0.18s ease;
  margin: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  &:hover {
    color: ${colors.primary};
    background: rgba(255, 255, 255, 0.06);
    box-shadow: none;
  }
`;

const ActionButtons = (props: { actions: any }): JSX.Element => {
  const actions = props.actions;
  if (!actions) return <></>;
  return (
    <ActionButtonContainer>
      {actions.map((action: Action, index: number) => (
        <Button
          key={`action-${index}`}
          styles={actionButtonStyles}
          onClick={action.onClick}
          title={action.label}
        >
          {action.icon}
        </Button>
      ))}
    </ActionButtonContainer>
  );
};

export default ActionButtons;
