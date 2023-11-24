export const Login: preact.FunctionComponent = () => (
  <form
    hx-post="/login/session"
    hx-target="body"
    hx-trigger="submit throttle:1s"
  >
    <input type="submit" name="authorize" value="Login" />
  </form>
);
