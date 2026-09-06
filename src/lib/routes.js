/*
  Where the app's pages live, as plain strings and nothing else.

  Split out of lib/navigation.js because src/proxy.js needs these paths and runs
  on the EDGE: importing the nav registry there would drag the whole icon library
  into the middleware bundle for the sake of two string constants. Nothing in
  here imports anything, so it is safe to read from the edge, the server and the
  browser alike.

  Adding an area means adding it here, giving it an entry in NAV_AREAS
  (lib/navigation.js), and adding its route to the matcher in src/proxy.js. A
  page missing from that matcher is one anybody can load without signing in.
*/

export const ROUTES = {
  inbox: '/inbox',
  today: '/today',
  tasks: '/tasks',
  login: '/login',
};

/*
  Where the app opens, and where `/` sends you.

  THE INBOX, on its capture stage: one box, cursor in it, nothing asked.

  It used to be /today, on the reasoning that the first question on opening a
  task app is "what am I doing today". That is the right first question when you
  SAT DOWN to use the app. But most openings are not that — something occurred
  to you and you reached for your phone — and for those, any landing page that
  is not a text box is a page you have to get past before you can write the
  thought down, which is how thoughts get lost.

  Planning a day is a thing you go to on purpose, and it is one tap away in the
  bar. Catching a thought is not, so it is what the app opens holding.

  NOT the same thing as "where the Google Calendar flow comes back to": that is
  /today by name (see api/google/*), because it means the page with the calendar
  on it, and it must not follow this constant around.
*/
export const HOME_PATH = ROUTES.inbox;
