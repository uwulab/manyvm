const core = require("@actions/core");
const github = require("@actions/github");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

show_message = (type, message) => {
  if (type == "error") {
    core.setFailed(message);
  } else if (type == "fatal") {
    core.setFailed(message);
    process.exit(1);
  } else {
    core.info(message);
  }
};

setup_precompiled_erlang = (version) => {
  const operatingSystem = process.platform;
  let arch = process.arch;
  if (operatingSystem === "linux") {
    // for linux, there is only one possible architecture on GitHub Action
    // which is x64, so we can ignore the arch parameter
    // and pass x86_64 directly
    download_precompiled_erlang("linux", "x86_64", version);
  } else if (operatingSystem === "win32") {
    show_message("fatal", "Windows is not supported yet.");
  } else if (operatingSystem === "darwin") {
    show_message("fatal", "macOS is not supported yet.");
    // // for macOS, it's possible to have two architectures in the future
    // // which are `x64` and `arm64` (from process.arch), so we need to pass the arch parameter
    // if (arch == "x64") {
    //   arch = "x86_64";
    // }
    // download_precompiled_erlang("darwin", arch, version);
  } else {
    show_message("fatal", `Unsupported operating system: ${operatingSystem}`);
  }
};

download_precompiled_erlang = (os, arch, version) => {
  let [erlang_url, filename] = get_precompiled_erlang_url_template(
    os,
    arch,
    version
  );
  show_message("info", `Downloading Erlang/OTP image from ${erlang_url}`);
  download_file(erlang_url, `/tmp/${filename}`);
  show_message("info", `Extracting Erlang/OTP`);

  const result = spawnSync(
    "bash",
    [
      "-c",
      `mkdir -p /tmp/otp-${version} && tar -C /tmp/otp-${version} -xzf /tmp/${filename}`,
    ],
    {
      stdio: "inherit",
    }
  );
  if (result.status === 0) {
    show_message("info", "Erlang/OTP extracted successfully.");
  } else {
    show_message(
      "fatal",
      `Error extracting Erlang/OTP. Exit code: ${result.status}`
    );
  }
};

get_precompiled_erlang_url_template = (os, arch, version) => {
  let triplet = "";
  if (os == "linux") {
    triplet = `${arch}-linux-gnu`;
  } else if (os == "darwin") {
    triplet = `${arch}-apple-darwin`;
  } else {
    show_message("fatal", `Unsupported operating system: ${os}`);
  }
  let filename = `otp-${triplet}.tar.gz`;
  return [
    `https://github.com/cocoa-xu/otp-build/releases/download/v${version}/${filename}`,
    filename,
  ];
};

setup_elixir = (elixir_version, erlang_version) => {
  show_message("info", `Downloading Elixir ${elixir_version}`);
  download_file(
    `https://github.com/elixir-lang/elixir/archive/refs/tags/v${elixir_version}.tar.gz`,
    `/tmp/elixir-${elixir_version}.tar.gz`
  );
  show_message("info", `Extracting Elixir ${elixir_version}`);
  const result = spawnSync(
    "bash",
    [
      "-c",
      `mkdir -p /tmp/elixir-${elixir_version} && tar -C /tmp/elixir-${elixir_version} -xzf /tmp/elixir-${elixir_version}.tar.gz --strip-components 1`,
    ],
    {
      stdio: "inherit",
    }
  );
  if (result.status === 0) {
    show_message("info", `Elixir ${elixir_version} extracted successfully.`);
  } else {
    show_message(
      "fatal",
      `Error extracting Elixir ${elixir_version}. Exit code: ${result.status}`
    );
  }

  show_message("info", `Building Elixir ${elixir_version}`);
  const env_vars = {
    PATH: `/tmp/otp-${erlang_version}/usr/local/bin:/tmp/elixir-${elixir_version}/bin:${process.env.PATH}`,
    ERL_ROOTDIR: `/tmp/otp-${erlang_version}/usr/local/lib/erlang`
  };
  const result2 = spawnSync(
    "bash",
    [
      "-c",
      `cd /tmp/elixir-${elixir_version} && make clean compile && mix local.hex --force && mix local.rebar --force`,
    ],
    {
      stdio: "inherit",
      env: { ...process.env, ...env_vars } 
    }
  );
  if (result2.status === 0) {
    show_message("info", `Elixir ${elixir_version} built successfully.`);
  } else {
    show_message(
      "fatal",
      `Error building Elixir ${elixir_version}. Exit code: ${result2.status}`
    );
  }
};

setup_precompiled_qemu = (version) => {
  show_message("info", `Downloading QEMU ${version}`);
  let triplet = "x86_64-linux-gnu";
  let filename = `qemu-${triplet}.tar.gz`;
  download_file(
    `https://github.com/cocoa-xu/qemu-build/releases/download/v${version}/${filename}`,
    `/tmp/qemu-${version}-${triplet}.tar.gz`
  );
  show_message("info", `Extracting QEMU ${version}`);
  const result = spawnSync(
    "bash",
    [
      "-c",
      `mkdir -p /tmp/qemu-${version} && tar -C /tmp/qemu-${version} -xzf /tmp/qemu-${version}-${triplet}.tar.gz`,
    ],
    {
      stdio: "inherit",
    }
  );
  if (result.status === 0) {
    show_message("info", `QEMU ${version} extracted successfully.`);
  } else {
    show_message(
      "fatal",
      `Error extracting QEMU ${version}. Exit code: ${result.status}`
    );
  }
};

get_freebsd_image_url_template = (version, arch) => {
  version == "latest" && (version = "14.0");
  let [base_url, subdir] = ["14.0", "13.2", "12.4"].includes(version)
    ? [
        `https://download.freebsd.org/releases/VM-IMAGES/${version}-RELEASE`,
        "Latest",
      ]
    : [
        `http://ftp-archive.freebsd.org/pub/FreeBSD-Archive/old-releases/VM-IMAGES/${version}-RELEASE`,
        "",
      ];

  let [url_arch, os_arch, instruction_set] =
    {
      amd64: ["amd64", "", "amd64"],
      x86_64: ["amd64", "", "amd64"],
      i386: ["i386", "", "i386"],
      aarch64: ["aarch64", "arm64", "aarch64"],
      riscv64: ["riscv64", "riscv", "riscv64"],
    }[arch] ||
    (() => {
      throw new Error(`Unknown architecture: ${arch}`);
    })();

  let filename = `FreeBSD-${version}-RELEASE-${
    !os_arch ? "" : `${os_arch}-`
  }${instruction_set}.qcow2.xz`;
  return [
    `${base_url}/${url_arch}/${!subdir ? "" : `${subdir}/`}${filename}`,
    filename,
  ];
};

get_filename_from_url = (url) => {
  const parsed_url = new URL(url);
  const pathname = parsed_url.pathname;
  return path.basename(pathname);
};

download_file = (url, filename) => {
  if (fs.existsSync(filename)) {
    show_message("info", `File ${filename} already exists, skipping.`);
    return;
  }

  const result = spawnSync("curl", ["-fSL", url, "-o", filename], {
    stdio: "inherit",
  });
  if (result.status === 0) {
    show_message("info", "File downloaded successfully.");
  } else {
    show_message(
      "fatal",
      `Error downloading the file. Exit code: ${result.status}`
    );
  }
};

start_vm = (erlang_version, elixir_version, qemu_version, os, arch, filename) => {
  show_message("info", "Starting VM");
  const env_vars = {
    PATH: `/tmp/otp-${erlang_version}/usr/local/bin:/tmp/elixir-${elixir_version}/bin:/tmp/qemu-${qemu_version}/bin:${process.env.PATH}`,
    ERL_ROOTDIR: `/tmp/otp-${erlang_version}/usr/local/lib/erlang`
  };
  const result = spawnSync(
    "bash",
    [
      "-c",
      `elixir -no-halt qemu.exs ${os} ${arch} ${filename}`,
    ],
    {
      stdio: "inherit",
      env: { ...process.env, ...env_vars }
    }
  );
  if (result.status === 0) {
    show_message("info", "VM started successfully.");
  } else {
    show_message("fatal", `Error starting VM. Exit code: ${result.status}`);
  }
};

try {
  //   const os = core.getInput('os');
  //   const version = core.getInput('version');
  //   const arch = core.getInput('arch');
  //   let os_image_url = core.getInput('os_image_url');

  const erlang_version = "26.2.1";
  const elixir_version = "1.16.0";
  const qemu_version = "8.2.0";
  setup_precompiled_erlang(erlang_version);
  setup_elixir(elixir_version, erlang_version);
  setup_precompiled_qemu(qemu_version);

  let filename = "";

  let [os, version, arch] = ["freebsd", "latest", "amd64"];
  let os_image_url = "";

  if (os_image_url) {
    filename = get_filename_from_url(os_image_url);
    show_message("info", `Using custom image URL: ${os_image_url}`);
  } else {
    switch (os) {
      case "freebsd":
        [os_image_url, filename] = get_freebsd_image_url_template(
          version,
          arch
        );
        break;
      default:
        show_message("fatal", `Unknown OS: ${os}`);
    }
    show_message("info", `Using image URL: ${os_image_url}`);
  }

  show_message("info", `Downloading ${os} image from ${os_image_url}`);
  download_file(os_image_url, filename);
  start_vm(erlang_version, elixir_version, qemu_version, os, arch, filename);
} catch (error) {
  show_message("fatal", error.message);
}