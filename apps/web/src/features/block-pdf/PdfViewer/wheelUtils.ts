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

let unusedTicks: number = 0;

export function accumulateWheelTicks(ticks: number) {
  // If the scroll direction changed, reset the accumulated wheel ticks.
  if ((unusedTicks > 0 && ticks < 0) || (unusedTicks < 0 && ticks > 0)) {
    unusedTicks = 0;
  }

  unusedTicks += ticks;
  const wholeTicks = Math.sign(unusedTicks) * Math.floor(Math.abs(unusedTicks));
  unusedTicks -= wholeTicks;
  return wholeTicks;
}

export function normalizeWheelEventDirection(evt: WheelEvent) {
  let delta = Math.hypot(evt.deltaX, evt.deltaY);
  const angle = Math.atan2(evt.deltaY, evt.deltaX);
  if (-0.25 * Math.PI < angle && angle < 0.75 * Math.PI) {
    // All that is left-up oriented has to change the sign.
    delta = -delta;
  }
  return delta;
}
