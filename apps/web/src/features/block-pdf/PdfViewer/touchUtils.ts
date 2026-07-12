// https://github.com/mozilla/pdf.js/blob/21e622769b59717575619a57f2e4448497ac78a9/web/app.js

/* Copyright 2012 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

type TouchInfo = {
  identifier: number;
  pageX: number;
  pageY: number;
};

let touches: [TouchInfo, TouchInfo] | null = null;
let touchUnusedTicks = 0;
let touchUnusedFactor = 1;

export function accumulateTouchTicks(ticks: number) {
  // If the direction changed, reset the accumulated ticks.
  if (
    (touchUnusedTicks > 0 && ticks < 0) ||
    (touchUnusedTicks < 0 && ticks > 0)
  ) {
    touchUnusedTicks = 0;
  }

  touchUnusedTicks += ticks;
  const wholeTicks = Math.trunc(touchUnusedTicks);
  touchUnusedTicks -= wholeTicks;

  return wholeTicks;
}

export function accumulateTouchFactor(previousScale: number, factor: number) {
  if (factor === 1) {
    return 1;
  }

  // If the direction changed, reset the accumulated factor.
  if (
    (touchUnusedFactor > 1 && factor < 1) ||
    (touchUnusedFactor < 1 && factor > 1)
  ) {
    touchUnusedFactor = 1;
  }

  const newFactor =
    Math.floor(previousScale * factor * touchUnusedFactor * 100) /
    (100 * previousScale);
  touchUnusedFactor = factor / newFactor;

  return newFactor;
}

export function touchStartHandler(evt: TouchEvent) {
  if (evt.touches.length < 2) {
    return;
  }

  evt.preventDefault();

  if (evt.touches.length !== 2) {
    return;
  }

  let [touch0, touch1] = evt.touches;
  if (touch0.identifier > touch1.identifier) {
    [touch0, touch1] = [touch1, touch0];
  }

  touches = [
    {
      identifier: touch0.identifier,
      pageX: touch0.pageX,
      pageY: touch0.pageY,
    },
    {
      identifier: touch1.identifier,
      pageX: touch1.pageX,
      pageY: touch1.pageY,
    },
  ];
}

export function touchEndHandler(evt: TouchEvent) {
  if (!touches) {
    return;
  }

  evt.preventDefault();

  touches = null;
  touchUnusedTicks = 0;
  touchUnusedFactor = 1;
}

export function getTouches() {
  return touches;
}

export function setTouches(newTouches: [TouchInfo, TouchInfo] | null) {
  touches = newTouches;
}
