// Speed units. 1 world unit = 1.25 m, so 1 u/s = 4.5 km/h: the HUD shows speed * KMH_PER_U as km/h and that is the true ground speed.
// (Until this was introduced the HUD used 6.2, which showed ~38 % more than the car really covered.) SPEED_SCALE = 6.2 / 4.5
// is the factor every speed and acceleration of the old tuning was multiplied by, so the same km/h on the dial now covers real ground.
export const KMH_PER_U = 4.5;
export const SPEED_SCALE = 6.2 / 4.5;
