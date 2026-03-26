use rand::seq::SliceRandom;
use rand::Rng;
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(tag = "mode", rename_all = "lowercase")]
pub enum GeneratorOptions {
    Charset(CharsetOptions),
    Passphrase(PassphraseOptions),
    Pattern(PatternOptions),
}

#[derive(Debug, Deserialize)]
pub struct CharsetOptions {
    pub length: usize,
    pub uppercase: bool,
    pub lowercase: bool,
    pub digits: bool,
    pub symbols: bool,
    pub exclude_ambiguous: bool,
    #[serde(default)]
    pub extra_chars: String, // user-defined extra characters
}

#[derive(Debug, Deserialize)]
pub struct PassphraseOptions {
    pub word_count: usize,      // typically 4-8
    pub separator: String,      // e.g. "-", " ", "_", ".", ""
    pub capitalize: bool,       // capitalize first letter of each word
    pub append_number: bool,    // append a random 2-digit number
    pub append_symbol: bool,    // append a random symbol
}

#[derive(Debug, Deserialize)]
pub struct PatternOptions {
    /// Pattern chars: x=lowercase, X=uppercase, d=digit, s=symbol, *=any, \=literal next char
    pub pattern: String,
}

// ── Serializable result also carries entropy ──────────────────────────────────

#[derive(Debug, Serialize)]
pub struct GeneratorResult {
    pub password: String,
    pub entropy_bits: f64,
}

const UPPERCASE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWERCASE: &[u8] = b"abcdefghijklmnopqrstuvwxyz";
const DIGITS:    &[u8] = b"0123456789";
const SYMBOLS:   &[u8] = b"!@#$%^&*()-_=+[]{}|;:,.<>?";
const AMBIGUOUS: &[char] = &['0', 'O', 'o', 'l', 'L', '1', 'I', '|'];

// 512 common English words — log2(512) = 9 bits/word
// 5 words → 45 bits, 6 words → 54 bits, 7 words → 63 bits
const WORDS: &[&str] = &[
    "able","above","acid","adapt","age","air","all","allow","also","alter",
    "among","angel","ankle","any","apart","apple","arch","area","arm","army",
    "art","ask","away","back","bake","ball","band","bank","bare","bark",
    "barn","base","beam","bean","bear","beat","been","bell","bend","best",
    "bird","bite","black","blade","blank","blow","blue","blur","board","body",
    "bold","bolt","bone","book","born","both","bowl","brain","bread","bring",
    "broad","brown","brush","burn","byte","call","calm","came","camp","care",
    "cash","cave","chat","chin","chip","city","clay","clip","coal","coat",
    "cold","come","cone","copy","cord","core","corn","cost","count","crew",
    "crop","crow","cult","cure","curl","dash","data","dawn","deal","deck",
    "deep","desk","dice","dish","disk","dock","dome","done","dose","down",
    "drag","draw","drip","drop","drum","duck","dune","dusk","dust","each",
    "earn","east","edge","else","even","ever","exam","face","fact","fail",
    "fame","fare","farm","fast","feat","feel","fell","find","fish","flag",
    "flame","flat","flip","flow","foam","fold","fond","food","ford","fork",
    "form","fort","four","free","from","fuel","full","fund","gain","game",
    "gang","give","glen","glow","goal","gone","grab","grain","grant","grasp",
    "gray","grid","grim","grip","grow","gulf","hand","hang","hard","harm",
    "hate","heap","heat","herb","hero","hide","high","hill","hire","hole",
    "home","hook","hope","horn","hunt","hull","husk","inch","into","iron",
    "jade","jest","join","just","jump","keep","kind","knack","knife","knot",
    "know","lace","laid","lake","lamp","land","lane","lark","lawn","lazy",
    "lead","leap","left","lend","lens","lily","lime","line","link","lint",
    "live","load","loan","lock","lone","loom","made","mail","mark","mask",
    "maze","mean","mild","milk","mine","mint","miss","mole","more","moth",
    "move","much","nail","name","near","nest","nice","nine","norm","nose",
    "oat","once","open","orb","oval","over","pace","page","pain","palm",
    "path","pave","peak","peel","pine","pink","pipe","plan","plot","plow",
    "plus","pond","pool","port","pose","post","pray","pull","pump","pure",
    "push","raft","rain","rake","ramp","rash","rate","read","reel","rent",
    "rest","ring","riot","rise","risk","road","roam","role","roof","room",
    "rope","rose","rule","safe","sand","sane","save","scan","seal","seed",
    "send","shed","ship","shop","shut","silk","sing","sink","site","skin",
    "slam","slap","slim","slip","slow","slug","snow","sock","soft","soil",
    "sole","song","sort","soul","span","speak","spin","spot","spray","stab",
    "stack","stall","star","stir","stop","strap","such","suit","sung","swap",
    "tale","tall","tank","task","teach","tent","term","test","text","than",
    "them","tide","time","tiny","toad","tool","torn","tour","town","tree",
    "trim","troll","trout","true","tusk","twin","type","unit","vale","vane",
    "vast","veil","verb","vest","view","void","volt","wade","wake","walk",
    "wall","wash","wave","weed","wide","wild","wine","wink","wish","wolf",
    "word","work","worn","wrap","yawn","yell","zone","zoom","acid","aged",
    "aloe","arid","axis","bard","bash","bath","bead","beef","beg","belt",
    "bench","bile","bison","bland","blast","blend","blip","blob","boil","brow",
    "brew","bulb","bulk","bull","bun","burp","cab","cake","cane","carp",
    "cart","cast","chem","chest","chop","chug","cite","clam","clap","clog",
    "club","cob","cod","coil","cola","cowl","cram","crave","crib","crust",
    "cup","curb","dart","daze","dean","deed","demo","dial","diva","dope",
    "duel","dull","earl","emit","etch","evil","fend","fest","file","fill",
    "film","fist","flaw","flea","flick","fond","font","fool","fore","fort",
    "foul","fuse","gale","garb","gem","gig","gill","glare","glib","gnat",
    "gnaw","golf","gorge","gram","gravy","greed","greet","grew","grit","gross",
    "grub","guest","guide","gum","hack","hail","halt","heal","heel","hood",
    "hoop","howl","hulk","hump","hymn","idol","iris","isle","itch","jail",
    "jolt","kept","lapse","lava","lean","lick","lodge","lore","lure","mass",
    "meadow","molt","muff","must","newt","null","orca","pivot","plaid","pleat",
    "plum","poke","poll","pore","pour","prim","prod","prop","rasp","rave",
    "realm","rift","rink","rub","rune","scar","seep","self","sent","shade",
    "shore","silo","skip","slab","slant","slate","slope","slosh","smear","smelt",
    "smog","snag","snake","snap","snare","sneak","snort","soar","sour","spare",
    "spark","spear","spit","spoke","sport","squint","stage","stain","stoke",
    "storm","stout","straw","strip","stump","surge","sway","swear","sweep",
    "swell","swim","taut","tear","tick","tram","trio","trod","trump","tyrant",
    "vault","vow","wand","warp","wax","weal","wear","which","wilt","womb",
    "yam","yoga","yoke","adapt","alive","brave","chase","chill","civic","clone",
    "comet","coral","craft","crane","crest","crisp","cross","crown","curve",
    "cycle","dance","depth","devil","digit","drape","dream","drift","drink",
    "drive","drown","dwarf","elect","elite","ember","empty","epoch","equal",
    "event","exact","exist","extra","fable","faith","feast","fetch","fever",
    "fewer","field","fifth","final","fixed","flame","flesh","flint","flock",
    "flood","floor","fluid","flute","force","forge","forth","found","frame",
    "fresh","front","frost","fruit","fuzzy","ghost","giant","given","glade",
    "glide","globe","gloom","glove","grand","grant","grape","graph","grass",
    "graze","great","green","greet","grief","grill","grind","grove","guard",
    "guess","guild","guilt","guise","gusto","haven","heart","heavy","hedge",
    "hinge","honor","horse","hotel","house","hover","human","hurry","image",
    "index","inner","input","inter","inert","jelly","jewel","judge","juice",
    "karma","knife","kneel","label","large","later","layer","learn","least",
    "ledge","level","light","limit","liver","local","logic","lunar","magic",
    "major","maple","march","merge","merit","metal","micro","model","month",
    "moral","motor","mount","mouse","mourn","movie","muddy","multi","music",
    "nerve","never","night","noble","north","noted","novel","ocean","often",
    "olive","onset","order","other","outer","oxide","ozone","panel","paper",
    "patch","pause","peace","pearl","penny","phase","phone","photo","pilot",
    "pixel","place","plane","plant","plate","plaza","point","polar","power",
    "press","price","prime","print","prior","prize","probe","proof","prose",
    "proud","prove","prowl","proxy","pulse","queen","quest","quick","quiet",
    "quota","quote","radar","radio","rapid","reach","ready","rebel","recap",
    "relay","rider","right","rigid","risky","rival","river","robin","robot",
    "rocky","rouge","rough","round","royal","ruler","rural","rusty","saint",
    "salve","scale","scene","scope","score","scout","sense","serve","seven",
    "shade","shake","shall","shark","shift","shine","shirt","short","shout",
    "shove","sight","since","sixth","sized","skill","slash","slate","sleep",
    "slice","slide","small","smart","smell","smile","smoke","solar","solve",
    "sorry","south","space","spare","speak","speck","speed","spell","spend",
    "spice","spirit","spoke","spring","spree","staff","stale","stamp","stand",
    "state","steel","steep","stern","stick","stone","store","story","stout",
    "stove","staff","style","sugar","super","surge","swift","sword","swipe",
    "taboo","talon","tenth","theft","their","there","thick","thing","think",
    "third","those","throw","thumb","tiger","tight","title","toast","today",
    "token","trace","track","trade","trail","train","trait","tramp","trend",
    "trial","trick","troop","trust","truth","tulip","tuner","tango","ultra",
    "uncle","under","upper","urban","utter","valor","value","vapor","venom",
    "verse","vigor","viral","visit","vista","vital","vocal","voice","voter",
    "vowel","waste","watch","water","weave","wedge","weird","whale","wheat",
    "where","while","white","whole","witch","world","worse","worst","worth",
    "would","wound","wrath","write","yacht","young","yours","youth","zebra",
];

pub fn generate(opts: &GeneratorOptions) -> Result<GeneratorResult, String> {
    match opts {
        GeneratorOptions::Charset(o)    => gen_charset(o),
        GeneratorOptions::Passphrase(o) => gen_passphrase(o),
        GeneratorOptions::Pattern(o)    => gen_pattern(o),
    }
}

fn gen_charset(opts: &CharsetOptions) -> Result<GeneratorResult, String> {
    if opts.length < 4 {
        return Err("Longueur minimale : 4 caractères.".into());
    }
    if !opts.uppercase && !opts.lowercase && !opts.digits && !opts.symbols && opts.extra_chars.is_empty() {
        return Err("Au moins un type de caractère doit être activé.".into());
    }

    let mut charset: Vec<u8> = Vec::new();
    if opts.uppercase { charset.extend_from_slice(UPPERCASE); }
    if opts.lowercase { charset.extend_from_slice(LOWERCASE); }
    if opts.digits    { charset.extend_from_slice(DIGITS); }
    if opts.symbols   { charset.extend_from_slice(SYMBOLS); }
    for c in opts.extra_chars.bytes() { if !charset.contains(&c) { charset.push(c); } }

    if opts.exclude_ambiguous {
        charset.retain(|&c| !AMBIGUOUS.contains(&(c as char)));
    }
    if charset.is_empty() {
        return Err("Jeu de caractères vide.".into());
    }

    let mut rng = rand::thread_rng();
    let mut required: Vec<u8> = Vec::new();
    let pick_one = |pool: &[u8], rng: &mut rand::rngs::ThreadRng| -> u8 {
        *pool.choose(rng).unwrap()
    };
    if opts.uppercase { required.push(pick_one(UPPERCASE, &mut rng)); }
    if opts.lowercase { required.push(pick_one(LOWERCASE, &mut rng)); }
    if opts.digits    { required.push(pick_one(DIGITS, &mut rng)); }
    if opts.symbols   { required.push(pick_one(SYMBOLS, &mut rng)); }

    let mut password: Vec<u8> = required;
    while password.len() < opts.length {
        let c = charset[rng.gen_range(0..charset.len())];
        if opts.exclude_ambiguous && AMBIGUOUS.contains(&(c as char)) { continue; }
        password.push(c);
    }
    password.shuffle(&mut rng);
    let pw = String::from_utf8(password).map_err(|e| e.to_string())?;
    let entropy = (charset.len() as f64).log2() * opts.length as f64;
    Ok(GeneratorResult { password: pw, entropy_bits: entropy })
}

fn gen_passphrase(opts: &PassphraseOptions) -> Result<GeneratorResult, String> {
    if opts.word_count < 2 {
        return Err("Au moins 2 mots requis.".into());
    }
    let mut rng = rand::thread_rng();
    let mut words: Vec<String> = (0..opts.word_count)
        .map(|_| {
            let w = WORDS.choose(&mut rng).unwrap();
            if opts.capitalize {
                let mut c = w.chars();
                match c.next() {
                    None => String::new(),
                    Some(f) => f.to_uppercase().to_string() + c.as_str(),
                }
            } else {
                w.to_string()
            }
        })
        .collect();

    if opts.append_number {
        words.push(format!("{:02}", rng.gen_range(0..100)));
    }
    if opts.append_symbol {
        let sym = [b'!', b'@', b'#', b'$', b'%', b'&', b'*', b'+', b'?'];
        words.push((sym[rng.gen_range(0..sym.len())] as char).to_string());
    }

    let pw = words.join(&opts.separator);
    // Entropy: log2(word_list_size ^ word_count) + extras
    let word_entropy = (WORDS.len() as f64).log2() * opts.word_count as f64;
    let extra = if opts.append_number { (100f64).log2() } else { 0.0 }
              + if opts.append_symbol { (9f64).log2() } else { 0.0 };
    Ok(GeneratorResult { password: pw, entropy_bits: word_entropy + extra })
}

fn gen_pattern(opts: &PatternOptions) -> Result<GeneratorResult, String> {
    if opts.pattern.is_empty() {
        return Err("Motif vide.".into());
    }
    let mut rng = rand::thread_rng();
    let mut result = String::new();
    let mut chars = opts.pattern.chars().peekable();
    let mut char_count = 0usize;
    let mut avg_charset = 1.0f64;

    while let Some(c) = chars.next() {
        match c {
            '\\' => {
                if let Some(next) = chars.next() {
                    result.push(next);
                    char_count += 1;
                }
            }
            'x' => {
                result.push(LOWERCASE[rng.gen_range(0..LOWERCASE.len())] as char);
                avg_charset *= 26.0; char_count += 1;
            }
            'X' => {
                result.push(UPPERCASE[rng.gen_range(0..UPPERCASE.len())] as char);
                avg_charset *= 26.0; char_count += 1;
            }
            'd' => {
                result.push(DIGITS[rng.gen_range(0..DIGITS.len())] as char);
                avg_charset *= 10.0; char_count += 1;
            }
            's' => {
                result.push(SYMBOLS[rng.gen_range(0..SYMBOLS.len())] as char);
                avg_charset *= SYMBOLS.len() as f64; char_count += 1;
            }
            '*' => {
                let all: Vec<u8> = [UPPERCASE, LOWERCASE, DIGITS, SYMBOLS].concat();
                result.push(all[rng.gen_range(0..all.len())] as char);
                avg_charset *= all.len() as f64; char_count += 1;
            }
            other => { result.push(other); char_count += 1; }
        }
    }
    let entropy = if char_count > 0 { avg_charset.log2() } else { 0.0 };
    Ok(GeneratorResult { password: result, entropy_bits: entropy })
}
