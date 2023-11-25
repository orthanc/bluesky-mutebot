import { Content } from './Content';

export const Login: preact.FunctionComponent = () => (
  <div className="flex justify-center h-full flex-col">
    <div className="flex justify-center">
      <Content>
        <form hx-post="/login/session" hx-trigger="submit throttle:1s">
          <input
            type="submit"
            name="authorize"
            value="Login"
            className="rounded-full w-48 p-4 bg-bsky hover:bg-sky-500 active:bg-sky-500 text-white font-bold text-lg htmx-request:animate-pulse"
          />
        </form>
      </Content>
    </div>
  </div>
);
