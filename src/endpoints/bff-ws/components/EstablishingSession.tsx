import { render } from 'preact-render-to-string';
import { Content } from './Content';

export const EstablishingSession = () => {
  return <Content>Establishing Session.....</Content>;
};

export const renderEstablishingSession = () => render(<EstablishingSession />);
