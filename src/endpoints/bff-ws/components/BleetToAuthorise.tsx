import { render } from 'preact-render-to-string';
import { Content } from './Content';

export const BleetToAuthorise = ({ authKey }: { authKey: string }) => {
  return (
    <Content>
      Bleet the following to login to Mutebot
      <pre>
        @{process.env.BLUESKY_SERVICE_IDENTIFIER} let me in {authKey}
      </pre>
    </Content>
  );
};

export const renderBleetToAuthorise = (authKey: string) =>
  render(<BleetToAuthorise authKey={authKey} />);
