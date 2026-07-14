use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Deserialize)]
pub struct Node {
    #[serde(rename = "type")]
    pub node_type: String,
    pub text: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct Canvas {
    pub nodes: Vec<Node>,
}

/// Takes the raw json canvas file and parses it into searchable content for opensearch.
pub fn parse_canvas(content: &str) -> anyhow::Result<String> {
    tracing::trace!("parsing canvas");

    if content.is_empty() {
        tracing::trace!("canvas is empty");
        return Ok("".to_string());
    }

    let canvas: Canvas = match serde_json::from_str(content) {
        Ok(canvas) => canvas,
        Err(_) => {
            // It might be valid JSON, just not one that conforms to Canvas schema
            let valid_json = serde_json::from_str::<Value>(content).is_ok();
            if valid_json {
                tracing::trace!("canvas data does not conform to Canvas schema");
            } else {
                tracing::trace!("canvas data is invalid JSON");
            }
            return Ok("".to_string());
        }
    };

    let texts: Vec<String> = canvas
        .nodes
        .iter()
        .filter_map(|node| {
            if node.node_type == "text" {
                node.text.clone()
            } else {
                None
            }
        })
        .collect();

    Ok(texts.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_canvas() -> anyhow::Result<()> {
        let content = r##"{"nodes":[{"type":"text","x":-670.5325043546321,"y":-400.72317686005283,"width":265.6333312988281,"height":64,"edges":[],"style":{"fillColor":"#f5f5f5","strokeColor":"#a3a3a3","strokeWidth":2,"cornerRadius":0,"opacity":1,"textSize":24},"text":"THIS IS A TEXT NODE","followTextWidth":false,"id":"9yOtMCct"},{"type":"text","x":159.15968485105003,"y":-442.07855077684695,"width":354.48333740234375,"height":100,"edges":[],"style":{"fillColor":"#f5f5f5","strokeColor":"#a3a3a3","strokeWidth":2,"cornerRadius":0,"opacity":1,"textSize":24},"text":"THIS IS ALSO A **TEXT** node....","followTextWidth":false,"id":"ir-R21wy"},{"type":"pencil","x":-529.6657619505521,"y":-356.78309207345904,"width":210.65393588867005,"height":219.70042393296873,"edges":[],"coords":[[14.215909783897928,219.70042393296873],[12.92355434899821,218.4080684980689],[14.215909783897928,211.94629132356982],[24.55475326309653,188.68389349537313],[24.55475326309653,161.544429362477],[19.385331523497257,142.15909783897973],[11.631198914098377,125.35847718528214],[0,117.60434457588323],[1.2923554348998323,148.62087501347884],[6.461777174499048,157.66736305777755],[27.139464132896137,179.63740545107441],[43.940084786593786,192.5609598000726],[62.03306087519121,193.8533152349724],[86.58781413828768,157.66736305777755],[90.46488044298712,146.0361641436792],[90.46488044298712,138.2820315342803],[87.88016957318752,133.11260979468102],[82.71074783358824,129.23554348998158],[78.8336815288888,131.82025435978122],[73.66425978928953,146.0361641436792],[73.66425978928953,160.2520739275772],[77.54132609398897,165.42149566717643],[84.00310326848808,168.00620653697607],[95.6343021825864,166.71385110207626],[104.68079022688511,156.37500762287772],[112.43492283628404,139.5743869691801],[116.31198914098348,135.69732066448066],[118.89670001078309,116.31198914098343],[117.60434457588332,100.80372392218561],[109.85021196648438,81.41839239868835],[102.0960793570855,73.66425978928947],[104.68079022688511,73.66425978928947],[122.77376631548253,82.71074783358819],[135.69732066448074,86.58781413828763],[138.28203153428035,89.17252500808729],[142.1590978389798,89.17252500808729],[142.1590978389798,87.88016957318746],[144.74380870877945,89.17252500808729],[146.03616414367923,100.80372392218561],[142.1590978389798,116.31198914098343],[134.4049652295809,127.94318805508178],[134.4049652295809,122.7737663154825],[142.1590978389798,108.55785653158452],[156.37500762287777,95.63430218258634],[168.00620653697615,82.71074783358819],[171.8832728416756,76.24897065908908],[174.4679837114752,69.78719348459003],[174.4679837114752,64.61777174499076],[169.29856197187593,52.986572830892385],[131.8202543597813,21.970042393296865],[134.4049652295809,31.01653043759552],[142.1590978389798,38.77066304699446],[162.83678479737688,49.109506526192945],[186.09918262557358,54.27892826579222],[192.56095980007262,58.15599457049166],[197.7303815396719,58.15599457049166],[204.192158714171,60.74070544029132],[210.65393588867005,43.94008478659367],[210.65393588867005,16.800620653697592],[209.36158045377027,11.63119891409832],[204.192158714171,3.87706630469944],[200.31509240947156,0],[197.7303815396719,0]],"style":{"fillColor":"#f5f5f5","strokeColor":"#a3a3a3","strokeWidth":2,"cornerRadius":0,"opacity":1,"textSize":24},"wScale":1,"hScale":1,"id":"Jo81vmsN"},{"type":"pencil","x":-392.6760858511716,"y":-370.99900185735703,"width":51.694217395992666,"height":72.37190435438964,"edges":[],"coords":[[0,72.37190435438964],[2.5847108697996646,64.61777174499076],[7.754132609398937,60.74070544029132],[10.338843479198545,51.69421739599261],[46.524795656393394,9.046488044298712],[51.694217395992666,0],[51.694217395992666,3.87706630469944]],"style":{"fillColor":"#f5f5f5","strokeColor":"#a3a3a3","strokeWidth":2,"cornerRadius":0,"opacity":1,"textSize":24},"wScale":1,"hScale":1,"id":"AX-OFXTm"},{"type":"pencil","x":-537.419894559951,"y":-356.78309207345904,"width":124.06612175038237,"height":182.22211632087405,"edges":[],"coords":[[0,182.22211632087405],[2.5847108697996646,173.17562827657534],[31.016530437595577,127.94318805508178],[71.07954891948987,72.37190435438964],[86.58781413828768,56.86363913559188],[104.68079022688511,32.30888587249535],[113.72727827118382,16.800620653697592],[122.77376631548253,6.461777174499048],[124.06612175038237,0]],"style":{"fillColor":"#f5f5f5","strokeColor":"#a3a3a3","strokeWidth":2,"cornerRadius":0,"opacity":1,"textSize":24},"wScale":1,"hScale":1,"id":"r1gXHBej"},{"type":"image","uuid":"0b84e9ab-c7a3-40f8-8d5c-1701b0acf144","x":-360.8830018491443,"y":-1190.51320378778,"width":658.2252806616834,"height":442.91794586580545,"edges":[],"style":{"strokeColor":"transparent"},"flipX":false,"flipY":false,"id":"TAdVZZDX"}],"edges":[{"from":{"type":"free","x":24.75471962146913,"y":-495.06512360773945},"to":{"type":"free","x":973.3436088379344,"y":-102.18907139819527},"style":{"fillColor":"#f5f5f5","strokeColor":"#a3a3a3","strokeWidth":2,"cornerRadius":0,"opacity":1,"textSize":24},"id":"s5Zs_EBd"},{"from":{"type":"free","x":602.4375990216871,"y":-507.9886779567376},"to":{"type":"free","x":153.99026311145076,"y":-6.55476921560886},"style":{"fillColor":"#f5f5f5","strokeColor":"#a3a3a3","strokeWidth":2,"cornerRadius":0,"opacity":1,"textSize":24},"id":"Ef2ILiXs"},{"from":{"type":"free","x":-642.1006847868362,"y":-455.0021051258451},"to":{"type":"free","x":-61.83309451681857,"y":70.98655687838013},"style":{"fillColor":"#f5f5f5","strokeColor":"#a3a3a3","strokeWidth":2,"cornerRadius":0,"opacity":1,"textSize":24},"id":"s-FLVgFl"},{"from":{"type":"free","x":-293.1647173638857,"y":-577.7758714413277},"to":{"type":"free","x":-519.3269184713536,"y":222.19214276165866},"style":{"fillColor":"#f5f5f5","strokeColor":"#a3a3a3","strokeWidth":2,"cornerRadius":0,"opacity":1,"textSize":24},"id":"wBAPtD4z"}]}"##;
        let result = parse_canvas(content)?;

        let text = ["THIS IS A TEXT NODE", "THIS IS ALSO A **TEXT** node...."];

        assert_eq!(result, text.join("\n"));

        Ok(())
    }
    #[test]
    fn test_parse_canvas_no_text() -> anyhow::Result<()> {
        let content = r##"{"nodes":[{"type":"not_text", "id": "random"}]}"##;
        let result = parse_canvas(content)?;

        assert_eq!(result, "".to_string());

        Ok(())
    }
}
