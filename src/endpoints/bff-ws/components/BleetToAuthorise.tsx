import { render } from 'preact-render-to-string';

export const BleetToAuthorise = ({ authKey }: { authKey: string }) => {
  return (
    <div id="bleet-to-authorize" hx-swap-oob="true">
      Bleet the following to login to Mutebot
      <pre>
        @{process.env.BLUESKY_SERVICE_IDENTIFIER} let me in {authKey}
      </pre>
    </div>
  );
};

export const renderBleetToAuthorise = (authKey: string) =>
  render(<BleetToAuthorise authKey={authKey} />);
