import { Content } from './Content';

export const EstablishingSession = () => {
  return (
    <Content>
      Establishing Session.....
      <form
        hx-get={`/login/session/auth-code`}
        hx-swap="outerHTML"
        hx-trigger="every 1s"
        hx-target="#content"
      ></form>
    </Content>
  );
};
