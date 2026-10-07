// Private stdin/stdout only. No clocks, network, credential/session reads or writes.
use pitools_core::{
    activity::Data,
    protocol::{Reply, Worker, MAX_FRAME},
};
use std::io::{self, BufRead, Read, Write};
fn send(out: &mut impl Write, reply: &Reply) -> io::Result<()> {
    serde_json::to_writer(&mut *out, reply)?;
    out.write_all(b"\n")?;
    out.flush()
}
fn main() -> io::Result<()> {
    let data = match Data::load() {
        Ok(d) => d,
        Err(_) => {
            send(
                &mut io::stdout(),
                &Reply::Fatal {
                    protocol: 1,
                    category: "invalid_assets",
                },
            )?;
            std::process::exit(3);
        }
    };
    let mut worker = Worker::new(data);
    let stdin = io::stdin();
    let mut input = stdin.lock();
    let stdout = io::stdout();
    let mut out = io::BufWriter::new(stdout.lock());
    let mut raw = Vec::new();
    loop {
        raw.clear();
        let read = (&mut input)
            .take((MAX_FRAME + 2) as u64)
            .read_until(b'\n', &mut raw)?;
        if read == 0 {
            return Ok(());
        }
        if raw.last() == Some(&b'\n') {
            raw.pop();
        }
        if raw.last() == Some(&b'\r') {
            raw.pop();
        }
        if raw.len() > MAX_FRAME {
            send(
                &mut out,
                &Reply::Fatal {
                    protocol: 1,
                    category: "frame_too_large",
                },
            )?;
            std::process::exit(2);
        }
        if raw.iter().all(|b| b.is_ascii_whitespace()) {
            continue;
        }
        match worker.handle(&raw) {
            Ok(Some(reply)) => {
                let fatal = matches!(reply, Reply::Fatal { .. });
                send(&mut out, &reply)?;
                if fatal {
                    std::process::exit(3);
                }
            }
            Ok(None) => {}
            Err(category) => send(&mut out, &worker.error(category))?,
        }
    }
}
