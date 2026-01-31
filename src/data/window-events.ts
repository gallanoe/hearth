/**
 * Window events for the library room.
 * Random observations the agent sees when looking outside.
 */

const windowEvents: string[] = [
  "A bird lands on the windowsill, pauses, then flies away.",
  "Clouds drift slowly across the sky.",
  "Rain begins to fall, streaking the glass.",
  "The wind picks up, rustling the trees in the distance.",
  "A cat walks along the fence outside, balancing carefully.",
  "The sun breaks through the clouds, casting warm light.",
  "Leaves tumble past the window, carried by a breeze.",
  "A squirrel scurries up a tree trunk.",
  "The sky darkens as evening approaches.",
  "Fog rolls in, softening the view.",
  "Snow begins to fall gently.",
  "A rainbow forms in the distance after the rain.",
  "Two birds chase each other across the sky.",
  "The moon is visible in the daytime sky.",
  "A delivery truck passes by on the road.",
  "Children walk past, laughing about something.",
  "An airplane leaves a trail across the sky.",
  "The trees sway rhythmically in the wind.",
  "A butterfly flutters past the window.",
  "Everything is still. Nothing moves.",
]

/**
 * Returns a random window event.
 */
export function getRandomWindowEvent(): string {
  const index = Math.floor(Math.random() * windowEvents.length)
  return windowEvents[index]
}
