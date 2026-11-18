// Building kinds and land cover shared by the city builder (studio) and the city generator (chicago.js).
// A landmark row is [name, x0, y0, x1, y1, height, onDeck, kind]; a field is { kind, rect: [x0, y0, x1, y1] } (map px).
export const BKINDS = {
  house:     { name: 'House',                       size: [3.2, 3.2], h: 9,   color: 0xe3d2b8, roof: 'gable', blurb: 'A small family house.' },
  terrace:   { name: 'Terraced houses',             size: [9, 3.6],   h: 11,  color: 0xb5694f, roof: 'gable', blurb: 'A row of brick houses.' },
  flats:     { name: 'Apartment block',             size: [7, 5],     h: 32,  color: 0xc9b79c, roof: 'resi',  blurb: 'Mid-rise flats with balconies.' },
  highrise:  { name: 'High-rise residential',       size: [7, 7],     h: 85,  color: 0xcfd3d8, roof: 'resi',  blurb: 'A residential tower, 20+ storeys.' },
  shopfront: { name: 'Shops with flats above',      size: [8, 5],     h: 16,  color: 0xd98f5a, roof: 'flat',  blurb: 'A street-front block: shops below, flats above.' },
  office:    { name: 'Office',                      size: [8, 7],     h: 70,  color: 0xb8c4d0, roof: 'flat',  blurb: 'A glass office block.' },
  tower:     { name: 'Skyscraper',                  size: [7, 7],     h: 140, color: 0x20242b, roof: 'tiers', blurb: 'A tall office tower.' },
  towershops:{ name: 'Skyscraper with shops below', size: [9, 9],     h: 130, color: 0x2a3340, roof: 'tiers', podium: 9, blurb: 'A tower on a wide shop podium: shops at street level.' },
  hall:      { name: 'Hall / warehouse',            size: [12, 8],    h: 14,  color: 0xa7adb3, roof: 'flat',  blurb: 'Wide and low.' },
  warehouse: { name: 'Logistics warehouse',         size: [16, 9],    h: 12,  color: 0x8f969c, roof: 'flat',  blurb: 'A long distribution shed.' },
  factory:   { name: 'Factory',                     size: [10, 8],    h: 18,  color: 0x8a7f78, roof: 'tank',  blurb: 'A works with a plant room on the roof.' },
  silo:      { name: 'Silo / tank',                 size: [3, 3],     h: 20,  color: 0xc3c8cc, roof: 'flat',  blurb: 'A tall storage tank.' },
  farmhouse: { name: 'Farmhouse',                   size: [4.4, 3.6], h: 8,   color: 0xf0e4d0, roof: 'gable', blurb: 'A farmhouse.' },
  barn:      { name: 'Barn',                        size: [8, 5],     h: 10,  color: 0xa63c32, roof: 'gable', blurb: 'A red barn.' }
};
export const FIELDS = {
  corn:    { name: 'Corn field',    color: 0x9bb23c, furrow: 0x6f8f2a, blurb: 'Rows of corn.' },
  wheat:   { name: 'Wheat field',   color: 0xdcbc5a, furrow: 0xbb9c40, blurb: 'Golden wheat.' },
  plowed:  { name: 'Ploughed field',color: 0x7a5a3a, furrow: 0x5e4429, blurb: 'Bare furrowed earth.' },
  grass:   { name: 'Grass land',    color: 0x5d9a45, blurb: 'Open grass.' },
  pasture: { name: 'Cattle pasture',color: 0x6aa84f, furrow: 0x5b9441, blurb: 'Pasture; grazing land beside the road.' },
  forest:  { name: 'Forest',        color: 0x2f5a2f, trees: true, blurb: 'Dense trees (oaks and others).' }
};
