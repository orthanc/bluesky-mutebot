import { Content } from './Content';

export const LoggedInLayout: preact.FunctionComponent = ({ children }) => (
  <>
    <form hx-post="/logout" hx-target="body" hx-trigger="submit throttle:1s">
      <input type="submit" value="Logout" />
    </form>
    <hr />
    <Content>{children}</Content>
    <hr />
    <form hx-post="/logout" hx-target="body" hx-trigger="submit throttle:1s">
      <input type="submit" value="Logout" />
    </form>
  </>
);
