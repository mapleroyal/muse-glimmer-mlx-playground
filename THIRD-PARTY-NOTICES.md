# Third-party notices

## ExecuTorch

[`patches/executorch-muse-cancel.patch`](patches/executorch-muse-cancel.patch) contains modifications to source files from [ExecuTorch](https://github.com/pytorch/executorch). Setup applies the patch to the pinned upstream revision before building the local worker. That source is distributed under the following BSD license:

```text
BSD License

For "ExecuTorch" software

Copyright (c) Meta Platforms, Inc. and affiliates.
Copyright 2023 Arm Limited and/or its affiliates.
Copyright (c) Qualcomm Innovation Center, Inc.
Copyright (c) 2023 Apple Inc.
Copyright (c) 2024 MediaTek Inc.
Copyright 2023 NXP
Copyright (c) 2025 Samsung Electronics Co. LTD
Copyright (c) Intel Corporation

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

 * Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

 * Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

 * Neither the name Meta nor the names of its contributors may be used to
   endorse or promote products derived from this software without specific
   prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

## Muse Glimmer model files

Model files are downloaded during setup and are not included in this repository. They are distributed separately under the [Apache License 2.0](https://huggingface.co/meta-models/Muse-Glimmer-30B-ExecuTorch-PTE/blob/b0376783689fb024c95b43a063552f938c678ec2/LICENSE) and the [Muse Glimmer Usage Policy](https://huggingface.co/meta-models/Muse-Glimmer-30B-ExecuTorch-PTE/blob/b0376783689fb024c95b43a063552f938c678ec2/USAGE_POLICY.md).
