import { Content } from './Content';

export const BleetToAuthorise = ({ authKey }: { authKey: string }) => {
  return (
    <Content>
      Bleet the following to login to Mutebot
      <pre>!mutebot let me in {authKey}</pre>
      <form
        hx-get={`/login/session/approval`}
        hx-swap="outerHtml"
        hx-trigger="every 1s"
        hx-target="body"
      ></form>
    </Content>
  );
};
