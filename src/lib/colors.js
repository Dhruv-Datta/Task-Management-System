/*
  Reading text off a coloured background.

  The timeline draws blocks as SOLID colour — a list's colour, or the one
  Google gave the event — which means the text on top can no longer be a fixed
  grey. Every palette in play here has both ends of the range in it: this app's
  lists run from sky to amber, and Google's own runs from Blueberry to Banana.
  White on #fbd75b is not a colour scheme, it is an empty block.
*/

/**
 * White, or near-black, whichever can be read on `hex` ('#rrggbb').
 *
 * The weighted average below is the coarse sRGB brightness rather than the
 * gamma-corrected relative luminance — cruder than the standard says, and on
 * the right side of the fence for every colour either palette contains.
 * Anything that isn't a hex triple gets white, which is what a block with no
 * colour is drawn in anyway.
 */
export function inkOn(hex) {
  const rgb = String(hex || '').replace('#', '');
  if (rgb.length !== 6) return '#ffffff';
  const r = parseInt(rgb.slice(0, 2), 16);
  const g = parseInt(rgb.slice(2, 4), 16);
  const b = parseInt(rgb.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return '#ffffff';
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#1f2937' : '#ffffff';
}

/*
  EVERY TASK, ONE RED — Google's Tomato.

  A constant rather than the colour of the list the task came from, because the
  two are answers to different questions. A list is where the work is FILED, and
  that matters on /tasks where you are choosing what to work on. The timeline is
  a DAY, and the useful distinction on a day is between the hours you gave
  yourself and the hours somebody else already owns: one colour for all of yours
  draws that line in a single glance, where eight list colours draw a rainbow
  you have to decode first. The list is still named on the row beside the grid,
  which is where you read names rather than shapes.

  Google's own API palette calls Tomato #dc2127 (see googleCalendar.js); this is
  the deeper red the calendar actually draws today.
*/
export const TASK_COLOR = '#d50000';
