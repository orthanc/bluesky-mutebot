import { render } from 'preact-render-to-string';
import { Content } from './Content';

export const EstablishingSession = () => {
  return <>Establishing Session.....</>;
};

export const renderEstablishingSession = (oob: boolean) =>
  render(
    <Content oob={oob}>
      <EstablishingSession />
    </Content>
  );
