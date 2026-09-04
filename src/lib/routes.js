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
  today: '/today',
  tasks: '/tasks',
  login: '/login',
};

/*
  Where the app opens, and where `/` sends you.

  The overview rather than the task list: the first question on opening a task
  app is "what am I doing today", and only after answering it do you go to a
  particular list to work.
*/
export const HOME_PATH = ROUTES.today;
